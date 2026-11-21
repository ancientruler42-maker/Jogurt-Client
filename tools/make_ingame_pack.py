#!/usr/bin/env python3
"""Generates the Jogurt in-game UI textures into assets/ingame/.
Dev-time only: run `python3 tools/make_ingame_pack.py` after changing the design.
The launcher zips these files into a resource pack at launch time (see ui-pack.js)."""
import os, sys, math, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'ingame')
ICON = os.path.join(ROOT, 'assets', 'icon.png')
FONT = '/usr/share/fonts/truetype/google-fonts/ofl/archivoblack/ArchivoBlack-Regular.ttf'
FONT2 = '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf'
S = 4  # texture resolution multiplier over vanilla's logical pixels
rng = np.random.default_rng(7)

def hexc(h):
    h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], float)

def save(img, *parts):
    p = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if isinstance(img, np.ndarray):
        img = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGBA' if img.shape[2] == 4 else 'RGB')
    img.save(p, optimize=True)
    return p

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def rrect_sdf(w, h, r, inset=0.0):
    """Signed distance (px, negative inside) to a rounded rect covering the whole w x h image."""
    y, x = np.mgrid[0:h, 0:w].astype(float); x += .5; y += .5
    cx, cy = w / 2, h / 2
    qx = np.abs(x - cx) - (w / 2 - inset - r); qy = np.abs(y - cy) - (h / 2 - inset - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r

def noise(shape, sigma, amp, wrap=False):
    n = rng.standard_normal(shape); n = ndi.gaussian_filter(n, sigma, mode='wrap' if wrap else 'reflect')
    n /= (n.std() + 1e-9); return n * amp

# ------------------------------------------------------------------ buttons
STYLE = {
    'normal':   dict(top='#46b158', bot='#1d6e2f', border='#06200d', rim='#a8ffb4', rimA=.55, glow=0.0, sheen=.16),
    'hover':    dict(top='#63d877', bot='#2a8c40', border='#d2ffb4', rim='#ffffff', rimA=.65, glow=.45, sheen=.22),
    'disabled': dict(top='#2d3b31', bot='#1f2a23', border='#0b120d', rim='#7e9684', rimA=.12, glow=0.0, sheen=.04),
}

def button(w, h, kind, radius=2.4):
    st = STYLE[kind]; W, H = int(w * S), int(h * S); r = radius * S
    d = rrect_sdf(W, H, r)
    alpha = np.clip(.5 - d, 0, 1)
    bw = 1.1 * S
    y = np.mgrid[0:H, 0:W][0].astype(float) / H
    top, bot, bc = hexc(st['top']), hexc(st['bot']), hexc(st['border'])
    col = top[None, None] * (1 - y[..., None]) + bot[None, None] * y[..., None]
    col = np.broadcast_to(col, (H, W, 3)).copy()
    # glass sheen on the upper half
    sheen = smooth(.62, .0, y) * st['sheen']
    col += sheen[..., None] * 255 * np.array([.7, 1, .75])
    # inner rim light (top edge) and soft inner shade (bottom edge)
    inside = -d
    rim = np.exp(-((inside - bw - .8 * S) / (.7 * S)) ** 2) * smooth(.55, .0, y) * st['rimA']
    col = col * (1 - rim[..., None]) + hexc(st['rim'])[None, None] * rim[..., None]
    shade = np.exp(-((inside - bw - .7 * S) / (1.1 * S)) ** 2) * smooth(.55, 1, y) * .25
    col *= (1 - shade[..., None])
    if st['glow']:
        g = np.exp(-np.clip(inside - bw, 0, None) / (3.2 * S)) * st['glow']
        col = col * (1 - g[..., None] * .6) + hexc('#b7ff9c')[None, None] * g[..., None] * .6
    col += noise((H, W), .8, 2.2)[..., None]
    border = smooth(bw + .6, bw - .6, inside)  # 1 on the border, 0 further in
    col = col * (1 - border[..., None]) + bc[None, None] * border[..., None]
    out = np.dstack([col, alpha * 255])
    return out

def field(w, h, hot, radius=2.0):
    W, H = int(w * S), int(h * S); r = radius * S
    d = rrect_sdf(W, H, r); alpha = np.clip(.5 - d, 0, 1); inside = -d
    y = np.mgrid[0:H, 0:W][0].astype(float) / H
    a, b = hexc('#07140b'), hexc('#10281a')
    col = a[None, None] * (1 - y[..., None]) + b[None, None] * y[..., None]
    col = np.broadcast_to(col, (H, W, 3)).copy()
    bw = 1.0 * S
    bc = hexc('#8cff93' if hot else '#3b7a49')
    lip = np.exp(-((inside - bw - .4 * S) / (.8 * S)) ** 2) * smooth(.5, 1, y) * .18
    col += lip[..., None] * 255 * np.array([.4, 1, .5])
    col += noise((H, W), .9, 1.8)[..., None]
    border = smooth(bw + .6, bw - .6, inside)
    col = col * (1 - border[..., None]) + bc[None, None] * border[..., None]
    return np.dstack([col, alpha * 255])

# ------------------------------------------------------------------ hotbar
def hotbar():
    W, H = 182 * S, 22 * S
    d = rrect_sdf(W, H, 2.4 * S); alpha = np.clip(.5 - d, 0, 1) * (225 / 255); inside = -d
    y = np.mgrid[0:H, 0:W][0].astype(float) / H
    a, b = hexc('#0d2415'), hexc('#07150c')
    col = a[None, None] * (1 - y[..., None]) + b[None, None] * y[..., None]
    col = np.broadcast_to(col, (H, W, 3)).copy()
    bw = 1.0 * S; bc = hexc('#2f7a40')
    border = smooth(bw + .6, bw - .6, inside)
    col = col * (1 - border[..., None]) + bc[None, None] * border[..., None]
    im = Image.fromarray(np.clip(np.dstack([col, alpha * 255]), 0, 255).astype(np.uint8), 'RGBA')
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
    for i in range(9):
        x0 = (1 + 20 * i) * S + int(.7 * S); x1 = (21 + 20 * i) * S - int(.7 * S)
        y0 = int(1.7 * S); y1 = H - int(1.7 * S)
        dr.rounded_rectangle([x0, y0, x1, y1], radius=int(1.2 * S), fill=(46, 112, 62, 85), outline=(120, 235, 140, 70), width=max(1, S // 4))
        dr.line([x0 + S, y0 + 1, x1 - S, y0 + 1], fill=(190, 255, 200, 60), width=max(1, S // 4))
    return Image.alpha_composite(im, ov)

def hotbar_selection():
    W = H = 24 * S
    y, x = np.mgrid[0:H, 0:W].astype(float)
    d = rrect_sdf(W, H, 3.0 * S)
    inside = -d; th = 1.6 * S
    ring = smooth(th + .8, th - .8, inside) * smooth(-.8, .8, inside)
    glow = np.exp(-np.clip(inside - th, 0, None) / (2.2 * S)) * (inside > 0) * .55
    col = np.zeros((H, W, 3)); col[:] = hexc('#c8ff9e')
    grad = (y / H)[..., None]
    col = col * (1 - .25 * grad) + hexc('#5fe070')[None, None] * .25 * grad
    a = np.clip(ring + glow * (1 - ring), 0, 1)
    glow_col = hexc('#6dff86')
    col = col * ring[..., None] + glow_col[None, None] * (1 - ring[..., None])
    return np.dstack([col, a * 255])

# ------------------------------------------------------------------ logo
def text_mask(txt, font_path, size, pad=0):
    f = ImageFont.truetype(font_path, size)
    l, t, r, b = f.getbbox(txt)
    im = Image.new('L', (r - l + pad * 2, b - t + pad * 2), 0)
    ImageDraw.Draw(im).text((pad - l, pad - t), txt, font=f, fill=255)
    return im

def make_logo(Wl, Hl, scale):
    """Wordmark with the Jogurt cup. Logical size Wl x Hl, rendered at `scale`x."""
    W, H = Wl * scale, Hl * scale
    ss = 2  # supersample
    cw, ch = W * ss, H * ss
    canvas = np.zeros((ch, cw, 4), float)

    icon = Image.open(ICON).convert('RGBA')
    ih = int(ch * 0.98); iw = ih
    icon = icon.resize((iw, ih), Image.LANCZOS)
    ix, iy = int(cw * 0.012), int(ch * 0.01)
    # cup + soft shadow
    sh = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    a = icon.split()[3].point(lambda v: int(v * .55))
    blk = Image.new('RGBA', icon.size, (0, 20, 5, 255)); blk.putalpha(a)
    sh.paste(blk, (ix + int(ch * .03), iy + int(ch * .04)))
    sh = sh.filter(ImageFilter.GaussianBlur(ch * .03))
    layer = Image.alpha_composite(sh, Image.new('RGBA', (cw, ch), (0, 0, 0, 0)))
    full = Image.new('RGBA', (cw, ch), (0, 0, 0, 0)); full.paste(icon, (ix, iy), icon)
    layer = Image.alpha_composite(layer, full)

    # wordmark region
    tx0 = ix + iw - int(ch * .06); tx1 = cw - int(cw * .012)
    avail_w = tx1 - tx0; avail_h = int(ch * 0.80)
    size = 400
    m = text_mask('JOGURT', FONT, size)
    k = min(avail_w * .94 / m.width, avail_h / m.height)
    m = text_mask('JOGURT', FONT, max(8, int(size * k)))
    tw, th = m.size
    px = tx0 + (avail_w - tw) // 2; py = int(ch * .06)
    mask = np.zeros((ch, cw), float); mask[py:py + th, px:px + tw] = np.asarray(m, float) / 255

    # extrusion (stack of darker copies down/right)
    depth = int(ch * .085)
    ext = np.zeros_like(mask)
    ext_col = np.zeros((ch, cw, 3))
    for i in range(depth, 0, -1):
        sm = np.roll(np.roll(mask, i, axis=0), int(i * .55), axis=1)
        t = i / depth
        c = hexc('#1d8a3a') * (1 - t) + hexc('#06260f') * t
        upd = sm > ext
        ext_col[upd] = c; ext = np.maximum(ext, sm)
    # glow behind
    glow = ndi.gaussian_filter(np.maximum(mask, ext), ch * .045) * .9
    # face: gradient + bevel lighting
    yy = (np.mgrid[0:ch, 0:cw][0] - py) / max(th, 1)
    top, mid, bot = hexc('#e6ffc2'), hexc('#6fe07c'), hexc('#1c9c3c')
    t = np.clip(yy, 0, 1)[..., None]
    face = np.where(t < .5, top * (1 - t * 2) + mid * (t * 2), mid * (1 - (t - .5) * 2) + bot * ((t - .5) * 2))
    blur = ndi.gaussian_filter(mask, ch * .012)
    gy, gx = np.gradient(blur)
    lit = (-gx * .6 - gy * .8) * (ch * .09)
    face = face + np.clip(lit, -1, 1)[..., None] * 90
    band = np.exp(-((yy - .30) / .045) ** 2) * .22  # specular band
    face = face + band[..., None] * 255 * np.array([.8, 1, .8])
    face = np.clip(face, 0, 255)
    # outline
    edge = np.clip(ndi.maximum_filter(mask, size=max(3, int(ch * .028)) | 1) - mask, 0, 1)

    comp = np.zeros((ch, cw, 4))
    gcol = hexc('#52f06f')
    comp[..., :3] = gcol; comp[..., 3] = np.clip(glow, 0, 1) * 150
    def over(rgb, a):
        a = np.clip(a, 0, 1)[..., None]; out_a = a + comp[..., 3:4] / 255 * (1 - a)
        rgbn = (rgb * a + comp[..., :3] * comp[..., 3:4] / 255 * (1 - a)) / np.maximum(out_a, 1e-6)
        comp[..., :3] = rgbn; comp[..., 3:4] = out_a * 255
    over(ext_col, ext)
    over(np.broadcast_to(hexc('#04180a'), (ch, cw, 3)), edge)
    over(face, mask)
    base = Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), 'RGBA')
    final = Image.alpha_composite(base, layer) if False else Image.alpha_composite(layer, base)
    # cup in front of glow, text above: draw cup last so it stays crisp
    final = Image.alpha_composite(base, layer)
    return final.resize((W, H), Image.LANCZOS)

def edition_plate(w_px, h_px, art_w, art_h, scale):
    """'CLIENT EDITION' pill drawn into the top-left art_w x art_h region of a w_px x h_px image."""
    ss = 3
    aw, ah = art_w * scale * ss, art_h * scale * ss
    im = Image.new('RGBA', (aw, ah), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
    pad = int(ah * .06)
    dr.rounded_rectangle([pad, pad, aw - pad, ah - pad], radius=int(ah * .45), fill=(6, 30, 14, 235), outline=(110, 235, 130, 255), width=max(2, int(ah * .07)))
    f = ImageFont.truetype(FONT2, int(ah * .52))
    txt = 'CLIENT EDITION'
    l, t, r, b = f.getbbox(txt)
    tw = r - l
    # letter-spaced text
    sp = int(ah * .05); total = sum(f.getlength(c) for c in txt) + sp * (len(txt) - 1)
    x = (aw - total) / 2; y = (ah - (b - t)) / 2 - t
    for c in txt:
        dr.text((x, y + 1), c, font=f, fill=(0, 30, 8, 255)); dr.text((x, y), c, font=f, fill=(190, 255, 170, 255)); x += f.getlength(c) + sp
    im = im.resize((art_w * scale, art_h * scale), Image.LANCZOS)
    out = Image.new('RGBA', (w_px, h_px), (0, 0, 0, 0)); out.paste(im, (0, 0))
    return out

# ------------------------------------------------------------------ backgrounds
def bg_tile(size, base, amp, alpha=255):
    col = np.zeros((size, size, 4)); col[..., :3] = hexc(base)
    n = noise((size, size), 1.2, amp, wrap=True) + noise((size, size), 5, amp * 1.4, wrap=True)
    col[..., :3] += n[..., None] * np.array([.5, 1, .6])
    # faint diagonal sheen, periodic
    y, x = np.mgrid[0:size, 0:size] / size
    col[..., :3] += (np.sin((x + y) * 2 * np.pi) * amp * .5)[..., None] * np.array([.4, 1, .5])
    col[..., 3] = alpha
    return col

def separators():
    W, H = 32 * 4, 2 * 4
    hdr = np.zeros((H, W, 4)); hdr[:H // 2] = [0, 8, 2, 230]; hdr[H // 2:] = [54, 150, 74, 255]
    ftr = np.zeros((H, W, 4)); ftr[:H // 2] = [54, 150, 74, 255]; ftr[H // 2:] = [0, 8, 2, 230]
    return hdr, ftr

# ------------------------------------------------------------------ panorama
def fbm(shape, base_sigma, octaves=4):
    out = np.zeros(shape); amp = 1
    for o in range(octaves):
        out += noise(shape, base_sigma / (2 ** o), amp); amp *= .5
    return out / (out.std() + 1e-9)

def panorama(n=512):
    c0 = hexc('#030d07')
    v = np.linspace(0, 1, n)
    # vertical profile E(v): symmetric around the horizon, equals c0 at both edges
    horizon = np.exp(-((v - .5) / .26) ** 2)[:, None]
    E = c0[None] + horizon * (hexc('#0b4a22') - c0)[None] * .85
    E = E[:, None, :].repeat(n, 1)  # n x n x 3
    y, x = np.mgrid[0:n, 0:n] / n
    edge_u = smooth(0, .13, np.minimum(x, 1 - x)); edge_v = smooth(0, .16, np.minimum(y, 1 - y))
    w = edge_u * edge_v
    faces = {}
    for k in range(4):
        col = E.copy()
        g = np.random.default_rng(100 + k)
        # aurora curtains
        add = np.zeros((n, n, 3))
        for j in range(3):
            ph = g.uniform(0, 6.28); fr = g.choice([1, 1.5, 2]); amp = g.uniform(.05, .11)
            cen = .5 + (j - 1) * .1 + amp * np.sin(2 * np.pi * fr * x + ph)
            d = (y - cen)
            prof = np.where(d < 0, np.exp(-(d / .16) ** 2), np.exp(-(d / .045) ** 2))
            rays = .55 + .45 * np.clip(fbm((n, n), 9)[:, :], -1.5, 1.5) * .6
            rays = ndi.gaussian_filter(g.standard_normal((1, n)), (0, 3))[0]
            rays = (rays - rays.min()) / (np.ptp(rays) + 1e-9)
            inten = prof * (.35 + .9 * rays[None, :]) * [.9, .7, .55][j]
            cl = [hexc('#2dff8a'), hexc('#a6ff4d'), hexc('#22d6b0')][j] / 255
            add += inten[..., None] * cl[None, None] * 120
        # soft fog
        fog = np.clip(fbm((n, n), 40, 3), -1.5, 2) * .5 + .5
        add += (fog * horizon)[..., None] * np.array([.05, .35, .14]) * 50
        # bokeh orbs
        for _ in range(26):
            cx, cy = g.uniform(.1, .9), g.uniform(.15, .85); rr = g.uniform(.01, .045)
            dd = np.hypot(x - cx, y - cy)
            add += (np.exp(-(dd / rr) ** 2 * 1.6) * g.uniform(.15, .55))[..., None] * np.array([90, 255, 120]) * .5
        # stars
        st = np.zeros((n, n)); idx = g.integers(0, n, (140, 2)); st[idx[:, 0], idx[:, 1]] = g.uniform(.4, 1, 140)
        st = ndi.gaussian_filter(st, .8) * 14
        add += st[..., None] * np.array([200, 255, 210])
        # every face shares the same horizon band on its left/right edge, so the cube has no visible seams
        band = (np.exp(-((v - .5) / .11) ** 2)[:, None, None] * np.array([40, 190, 95])[None, None] * .62)
        col += band * (1 - w[..., None]) + add * w[..., None]
        col += rng.standard_normal((n, n, 1)) * .8
        faces[k] = np.clip(col, 0, 255)
    # top / bottom: uniform c0 with a faint radial glow that fades to c0 at the borders
    r = np.hypot(x - .5, y - .5) / .5
    glow = np.exp(-(r / .55) ** 2) * smooth(1, .75, r) * smooth(0, .12, np.minimum.reduce([x, y, 1 - x, 1 - y]))
    tb = c0[None, None] + glow[..., None] * np.array([6, 26, 12]) + rng.standard_normal((n, n, 1)) * .8
    faces[4] = faces[5] = np.clip(tb, 0, 255)
    return faces

# ------------------------------------------------------------------ main
def mcmeta_nine(w, h, border):
    return json.dumps({'gui': {'scaling': {'type': 'nine_slice', 'width': w, 'height': h, 'border': border}}}, indent=2)

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w').write(text)

def main():
    import shutil
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    MC = 'assets/minecraft/textures/gui'
    # --- modern sprites (1.20.2+)
    SP = f'modern/{MC}/sprites'
    for name, kind in [('button', 'normal'), ('button_highlighted', 'hover'), ('button_disabled', 'disabled')]:
        save(button(200, 20, kind), SP, 'widget', name + '.png')
        write(os.path.join(OUT, SP, 'widget', name + '.png.mcmeta'), mcmeta_nine(200, 20, 3))
    save(field(200, 20, False), SP, 'widget', 'slider.png'); write(os.path.join(OUT, SP, 'widget', 'slider.png.mcmeta'), mcmeta_nine(200, 20, 3))
    save(field(200, 20, True), SP, 'widget', 'slider_highlighted.png'); write(os.path.join(OUT, SP, 'widget', 'slider_highlighted.png.mcmeta'), mcmeta_nine(200, 20, 3))
    for name, kind in [('slider_handle', 'normal'), ('slider_handle_highlighted', 'hover')]:
        save(button(8, 20, kind, radius=2.0), SP, 'widget', name + '.png')
        write(os.path.join(OUT, SP, 'widget', name + '.png.mcmeta'), mcmeta_nine(8, 20, 3))
    save(field(200, 20, False), SP, 'widget', 'text_field.png'); write(os.path.join(OUT, SP, 'widget', 'text_field.png.mcmeta'), mcmeta_nine(200, 20, 3))
    save(field(200, 20, True), SP, 'widget', 'text_field_highlighted.png'); write(os.path.join(OUT, SP, 'widget', 'text_field_highlighted.png.mcmeta'), mcmeta_nine(200, 20, 3))
    hb, sel = hotbar(), hotbar_selection()
    save(hb, SP, 'hud', 'hotbar.png'); save(sel, SP, 'hud', 'hotbar_selection.png')

    # --- legacy widgets.png (<=1.20.1): 256x256 logical, buttons rows 46/66/86, hotbar (0,0), selection (0,22)
    L = Image.new('RGBA', (256 * S, 256 * S), (0, 0, 0, 0))
    L.paste(hb, (0, 0)); L.paste(Image.fromarray(np.clip(sel, 0, 255).astype(np.uint8), 'RGBA'), (0, 22 * S))
    for yy, kind in [(46, 'disabled'), (66, 'normal'), (86, 'hover')]:
        L.paste(Image.fromarray(np.clip(button(200, 20, kind), 0, 255).astype(np.uint8), 'RGBA'), (0, yy * S))
    save(L, f'legacy/{MC}/widgets.png')

    # --- logos
    new = make_logo(256, 44, S)
    c = Image.new('RGBA', (256 * S, 64 * S), (0, 0, 0, 0)); c.paste(new, (0, 0))
    save(c, f'logo_new/{MC}/title/minecraft.png')
    save(edition_plate(128 * S, 16 * S, 128, 14, S), f'logo_new/{MC}/title/edition.png')
    old = make_logo(310, 44, S)  # two 155x44 halves
    c = Image.new('RGBA', (256 * S, 256 * S), (0, 0, 0, 0))
    c.paste(old.crop((0, 0, 155 * S, 44 * S)), (0, 0)); c.paste(old.crop((155 * S, 0, 310 * S, 44 * S)), (0, 45 * S))
    save(c, f'logo_old/{MC}/title/minecraft.png')
    save(edition_plate(256 * S, 256 * S, 98, 14, S), f'logo_old/{MC}/title/edition.png')

    # --- backgrounds & separators
    solid = bg_tile(128, '#0a1b10', 3.5)
    for n in ['options_background', 'light_dirt_background', 'menu_background', 'menu_list_background']:
        save(solid, f'common/{MC}/{n}.png')
    glass = bg_tile(128, '#07170c', 3.0, alpha=190)
    for n in ['inworld_menu_background', 'inworld_menu_list_background']:
        save(glass, f'common/{MC}/{n}.png')
    hdr, ftr = separators()
    for n, a in [('header_separator', hdr), ('footer_separator', ftr), ('inworld_header_separator', hdr), ('inworld_footer_separator', ftr)]:
        save(a, f'common/{MC}/{n}.png')

    # --- panorama
    for k, a in panorama(512).items():
        save(a.astype(np.uint8), f'common/{MC}/title/background/panorama_{k}.png') if False else save(Image.fromarray(a.astype(np.uint8), 'RGB'), f'common/{MC}/title/background/panorama_{k}.png')

    # --- pack icon
    Image.open(ICON).convert('RGBA').resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, 'pack.png'), optimize=True)
    tot = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print('written', OUT, f'{tot/1e6:.2f} MB')

if __name__ == '__main__':
    main()
