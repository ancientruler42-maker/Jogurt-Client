const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { Auth } = require('msmc');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { DiscordPresence } = require('./discord');
const uiPack = require('./ui-pack');

/** Install Dawn-style title screen mod into the profile mods folder when a jar is available. */
function installJogurtTitleMod(gameDir, version) {
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  // Remove previous managed copies
  for (const f of fs.readdirSync(modsDir)) {
    if (/^jogurt-title.*\.jar$/i.test(f)) {
      try { fs.unlinkSync(path.join(modsDir, f)); } catch {}
    }
  }
  const candidates = [
    path.join(__dirname, 'mods', 'jogurt-title.jar'),
    path.join(__dirname, 'assets', 'mods', 'jogurt-title.jar'),
  ];
  // Prefer newest jar from local gradle build
  const libs = path.join(__dirname, 'mods', 'jogurt-title', 'build', 'libs');
  if (fs.existsSync(libs)) {
    const jars = fs.readdirSync(libs).filter(n => n.endsWith('.jar') && !n.includes('sources') && !n.includes('dev'));
    jars.sort();
    for (const j of jars) candidates.unshift(path.join(libs, j));
  }
  const src = candidates.find(p => fs.existsSync(p));
  if (!src) {
    log('Jogurt title mod jar not found (build mods/jogurt-title or place jogurt-title.jar in mods/)');
    return false;
  }
  // Only inject on 1.21.x for now (mod is built against 1.21.1)
  const ver = String(version || '');
  if (!/^1\.21(\.|$)/.test(ver) && !/^26\./.test(ver)) {
    log('Jogurt title mod skipped (targets Minecraft 1.21.x, profile is ' + ver + ')');
    return false;
  }
  const dest = path.join(modsDir, 'jogurt-title.jar');
  fs.copyFileSync(src, dest);
  log('Installed Jogurt title mod → ' + dest);
  return true;
}

const win32 = process.platform === 'win32';
const ROOT = path.join(app.getPath('appData'), '.jogurtclient');
const RUNTIME = path.join(ROOT, 'runtime');
const F = { session: path.join(ROOT, 'session.txt'), settings: path.join(ROOT, 'settings.json'), stats: path.join(ROOT, 'stats.json'), cache: path.join(ROOT, 'cache.json') };
const UA = { 'User-Agent': 'JogurtClient/2.0 (personal launcher)' };
let CONFIG = { apiUrl: '', updateRepo: '', discordClientId: '' };
try { CONFIG = { ...CONFIG, ...require('./config.json') }; } catch {}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };

const PERKS = [
  { id: 'sodium', slug: 'sodium', name: 'Sodium', desc: 'Rewritten rendering engine. The single biggest FPS gain.', tag: 'Rendering' },
  { id: 'lithium', slug: 'lithium', name: 'Lithium', desc: 'Optimizes game logic, physics and AI ticks.', tag: 'Logic' },
  { id: 'ferritcore', slug: 'ferrite-core', name: 'FerriteCore', desc: 'Dramatically reduces memory usage.', tag: 'Memory' },
  { id: 'entityculling', slug: 'entityculling', name: 'Entity Culling', desc: 'Skips rendering entities you cannot see.', tag: 'Rendering' },
  { id: 'immediatelyfast', slug: 'immediatelyfast', name: 'ImmediatelyFast', desc: 'Faster HUD, text and immediate-mode drawing.', tag: 'Rendering' },
  { id: 'moreculling', slug: 'moreculling', name: 'More Culling', desc: 'Culls hidden block faces and extra geometry.', tag: 'Rendering' },
  { id: 'dynamicfps', slug: 'dynamic-fps', name: 'Dynamic FPS', desc: 'Drops FPS when the window is unfocused.', tag: 'Efficiency' },
  { id: 'krypton', slug: 'krypton', name: 'Krypton', desc: 'Optimizes the network stack.', tag: 'Network' },
];
// Do NOT use -XX:+PerfDisableSharedMem — it hides the JVM from external tools
// (overlays, instance detectors, Discord, etc.) that scan hsperfdata / attach APIs.
const JVM_FLAGS = ['-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:MaxGCPauseMillis=200','-XX:+UnlockExperimentalVMOptions','-XX:+DisableExplicitGC','-XX:+AlwaysPreTouch','-XX:G1NewSizePercent=30','-XX:G1MaxNewSizePercent=40','-XX:G1HeapRegionSize=8M','-XX:G1ReservePercent=20','-XX:G1HeapWastePercent=5','-XX:G1MixedGCCountTarget=4','-XX:InitiatingHeapOccupancyPercent=15','-XX:G1MixedGCLiveThresholdPercent=90','-XX:G1RSetUpdatingPauseTimePercent=5','-XX:SurvivorRatio=32','-XX:MaxTenuringThreshold=1'];

/* ---------- settings ---------- */
const DEFAULTS = () => ({ theme: 'jogurt', jvmflags: true, fullscreen: false, snapshots: false, autoUpdate: true, discord: true, ingameUi: true, apiUrl: CONFIG.apiUrl, updateRepo: CONFIG.updateRepo, bio: '', visibility: { servers: true, singleplayer: true, modpacks: true }, lastUser: null, profiles: [], active: null });
const normProfile = p => ({ loader: 'fabric', extraMods: [], extraPacks: [], localMods: [], perks: {}, public: false, ram: 4, modpack: null, ...p });
function loadSettings() {
  const raw = readJson(F.settings, {});
  const s = { ...DEFAULTS(), ...raw };
  s.visibility = { ...DEFAULTS().visibility, ...(raw.visibility || {}) };
  if (!Array.isArray(s.profiles) || !s.profiles.length) {
    s.profiles = [{ id: 'default', name: 'My first modpack', version: raw.version || null, ram: raw.ram || 4, perks: raw.perks || {}, extraMods: raw.extraMods || [] }];
    s.active = 'default';
  }
  s.profiles = s.profiles.map(normProfile);
  if (!s.profiles.some(p => p.id === s.active)) s.active = s.profiles[0].id;
  return s;
}
const saveSettings = s => { writeJson(F.settings, s); return s; };

// Only the Microsoft-verified account "1rth" may change the update source and community server.
// Everyone else always uses the values baked into config.json at build time.
const OWNER = '1rth';
const isOwner = () => !!mcAuth && String(mcAuth.profile.name).toLowerCase() === OWNER;
const eff = s => (isOwner() ? s : { ...s, apiUrl: CONFIG.apiUrl, updateRepo: CONFIG.updateRepo });

let win, mcAuth = null, running = false;
const authManager = new Auth('select_account');
const send = (ch, d) => win && !win.isDestroyed() && win.webContents.send(ch, d);
const log = m => send('log', String(m));
const stage = (text, pct) => send('progress', { text, pct });

/* ---------- Discord Rich Presence ---------- */
const APP_START = Date.now();
const rpc = new DiscordPresence(CONFIG.discordClientId, st => send('discord-status', st));
const pres = { phase: 'idle', name: '', version: '', where: '', since: 0 };
function updatePresence() {
  const big = { large_image: 'jogurt', large_text: 'Jogurt Client' };
  const buttons = /^[\w.-]+\/[\w.-]+$/.test(CONFIG.updateRepo || '') ? [{ label: 'Get Jogurt Client', url: 'https://github.com/' + CONFIG.updateRepo }] : undefined;
  let a;
  if (pres.phase === 'playing') a = { details: `Playing ${pres.name}`.slice(0, 120), state: `Minecraft ${pres.version}${pres.where ? ' \u2022 ' + pres.where : ''}`, timestamps: { start: pres.since }, assets: big };
  else if (pres.phase === 'prep') a = { details: `Getting ${pres.name} ready`.slice(0, 120), state: `Minecraft ${pres.version}`, timestamps: { start: Date.now() }, assets: big };
  else a = { details: 'In the launcher', state: 'FPS-focused Minecraft', timestamps: { start: APP_START }, assets: big };
  if (buttons) a.buttons = buttons;
  rpc.set(a);
}
const setPresence = p => { Object.assign(pres, p); updatePresence(); };

function appIconPath() {
  // Prefer real filesystem paths (extraResources) over asar — Windows taskbar is picky.
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(process.resourcesPath || '', 'assets', 'icon.ico'),
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.png'),
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return path.join(__dirname, 'assets', 'icon.png');
}
function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700, minWidth: 960, minHeight: 620, title: 'Jogurt Client',
    icon: appIconPath(), backgroundColor: '#0c140e', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c140e', symbolColor: '#cfe8d0', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile('index.html');
  // Ensure the taskbar uses the Jogurt Client logo (themes may change in-window chrome later).
  try { win.setIcon(appIconPath()); } catch {}
}

/* ---------- helpers ---------- */
const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true }, (e, so, se) => res(e ? null : String(so) + String(se))));
const OK_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];
async function download(url, dest) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
const isOnline = async () => { try { await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { method: 'HEAD', signal: AbortSignal.timeout(3500) }); return true; } catch { return false; } };
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); }
const safe = (base, rel) => { const b = path.resolve(base), d = path.resolve(b, rel); if (!d.startsWith(b + path.sep)) throw new Error('Unsafe path in modpack: ' + rel); return d; };
const cleanJogurt = dir => { if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.startsWith('jogurt_')) fs.unlinkSync(path.join(dir, f)); };

/* ---------- Minecraft versions & Java ---------- */
let manifest = null;
async function getManifest() {
  if (manifest) return manifest;
  try {
    manifest = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { headers: UA })).json();
    writeJson(F.cache, { ...readJson(F.cache, {}), manifest });
  } catch { manifest = readJson(F.cache, {}).manifest || null; }
  if (!manifest) throw new Error('Could not load the Minecraft version list (are you offline?)');
  return manifest;
}
async function javaMajorFor(id) {
  const c = readJson(F.cache, {});
  if (c.majors && c.majors[id]) return c.majors[id];
  const v = (await getManifest()).versions.find(x => x.id === id);
  if (!v) throw new Error('Unknown Minecraft version ' + id);
  const j = await (await fetch(v.url, { headers: UA })).json();
  const n = (j.javaVersion && j.javaVersion.majorVersion) || 8;
  const major = n <= 8 ? 8 : n <= 17 ? 17 : n <= 21 ? 21 : n;
  writeJson(F.cache, { ...readJson(F.cache, {}), majors: { ...(c.majors || {}), [id]: major } });
  return major;
}
// Prefer javaw.exe on Windows (same as official launcher / Modrinth App) so external
// tools that scan for javaw + "Minecraft" window titles can detect the instance.
const javaExe = win32 ? 'javaw.exe' : 'java';
const javaExeFallback = win32 ? 'java.exe' : 'java';
function findJava(major) {
  const base = path.join(RUNTIME, 'jre' + major);
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    for (const exe of [javaExe, javaExeFallback]) {
      const p = path.join(base, d, 'bin', exe);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
async function ensureJava(major) {
  let j = findJava(major);
  if (j) return j;
  if (!win32) {
    const out = await run('java', ['-version']);
    const m = out && out.match(/version "(\d+)(?:\.(\d+))?/);
    if ((m ? (m[1] === '1' ? 8 : +m[1]) : 0) >= major) return 'java';
    throw new Error(`Java ${major} is required. Please install it.`);
  }
  stage(`Downloading Java ${major} (one time)...`, 3);
  const base = path.join(RUNTIME, 'jre' + major);
  fs.mkdirSync(base, { recursive: true });
  const zip = path.join(base, 'jre.zip');
  await download(`https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${process.arch === 'arm64' ? 'aarch64' : 'x64'}/jre/hotspot/normal/eclipse`, zip);
  stage('Unpacking Java...', 8);
  await run('tar', ['-xf', zip, '-C', base]);
  try { fs.unlinkSync(zip); } catch {}
  j = findJava(major);
  if (!j) throw new Error(`Java ${major} install failed`);
  return j;
}

/* ---------- Fabric, mods, modpacks ---------- */
async function installFabric(mc, wanted) {
  const loaders = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mc}`, { headers: UA })).json();
  if (!Array.isArray(loaders) || !loaders.length) throw new Error(`Fabric does not support ${mc}. Switch the modpack to Vanilla.`);
  const lv = wanted && loaders.some(l => l.loader.version === wanted) ? wanted : loaders[0].loader.version;
  const profile = await (await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${lv}/profile/json`, { headers: UA })).json();
  const dir = path.join(ROOT, 'versions', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}
async function installProject(slug, mc, seen, dir, loaders) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug) || seen.has(slug)) return;
  seen.add(slug);
  const q = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}` + (loaders ? `&loaders=${encodeURIComponent(JSON.stringify(loaders))}` : '');
  const r = await fetch(`https://api.modrinth.com/v2/project/${slug}/version?${q}`, { headers: UA });
  const vs = r.ok ? await r.json() : [];
  if (!vs.length) { log(`Skipped ${slug}: no build for ${mc}`); return; }
  const v = vs[0], file = v.files.find(f => f.primary) || v.files[0];
  fs.mkdirSync(dir, { recursive: true });
  log(`+ ${file.filename}`);
  const downloaded = path.join(dir, 'jogurt_' + path.basename(file.filename));
  await download(file.url, downloaded);
  const scan = inspectModFile(downloaded, file.filename);
  if (scan.status === 'blocked') { try { fs.unlinkSync(downloaded); } catch {} throw new Error(`Blocked suspicious mod ${file.filename}: ${scan.reasons.map(r => r.reason).join('; ')}`); }
  if (loaders) for (const d of v.dependencies || []) if (d.dependency_type === 'required' && d.project_id) await installProject(d.project_id, mc, seen, dir, loaders);
}
async function installModpack(prof, gameDir) {
  stage('Downloading modpack...', 8);
  let zipPath;
  if (prof.modpack.localPath && fs.existsSync(prof.modpack.localPath)) {
    zipPath = prof.modpack.localPath;
  } else {
    const v = await (await fetch(`https://api.modrinth.com/v2/version/${prof.modpack.versionId}`, { headers: UA })).json();
    const file = v.files.find(f => f.primary) || v.files[0];
    zipPath = path.join(ROOT, 'pack.tmp.mrpack');
    await download(file.url, zipPath);
  }
  const zip = new AdmZip(zipPath);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const mc = index.dependencies.minecraft, loader = index.dependencies['fabric-loader'];
  if (!loader) throw new Error('This modpack is not a Fabric pack (only Fabric packs are supported).');
  fs.rmSync(path.join(gameDir, 'mods'), { recursive: true, force: true });
  const files = index.files.filter(f => !(f.env && f.env.client === 'unsupported'));
  let done = 0;
  await pool(files, 6, async f => {
    if (!OK_HOSTS.includes(new URL(f.downloads[0]).hostname)) throw new Error('Modpack uses a download host that is not allowed: ' + f.downloads[0]);
    const dest = safe(gameDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(f.downloads[0], dest);
    if (f.hashes && f.hashes.sha1 && crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex') !== f.hashes.sha1) throw new Error('Checksum mismatch: ' + f.path);
    if (/^mods\/.+\.jar$/i.test(f.path)) {
      const scan = inspectModFile(dest, path.basename(f.path));
      if (scan.status === 'blocked') { try { fs.unlinkSync(dest); } catch {} throw new Error(`Modpack blocked by safety scan: ${path.basename(f.path)} (${scan.reasons.map(r => r.reason).join('; ')})`); }
    }
    stage(`Modpack files (${++done}/${files.length})...`, 10 + (done / files.length) * 22);
  });
  for (const e of zip.getEntries()) {
    const m = e.entryName.match(/^(?:client-)?overrides\/(.+)$/);
    if (e.isDirectory || !m) continue;
    const dest = safe(gameDir, m[1]);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
  }
  if (zipPath === path.join(ROOT, 'pack.tmp.mrpack')) { try { fs.unlinkSync(zipPath); } catch {} }
  return { mc, loader };
}

/* ---------- stats ---------- */
const loadStats = () => ({ totalMs: 0, launches: 0, spMs: 0, servers: {}, ...readJson(F.stats, {}) });
let sess = null;
function endSess() {
  if (!sess) return;
  const ms = Date.now() - sess.start, st = loadStats();
  if (sess.type === 'server') { const s = st.servers[sess.host] || (st.servers[sess.host] = { visits: 0, ms: 0, last: 0 }); s.ms += ms; s.last = Date.now(); } else st.spMs += ms;
  writeJson(F.stats, st); sess = null;
}
function startSess(type, host) {
  endSess();
  sess = { type, host, start: Date.now() };
  if (pres.phase === 'playing') setPresence({ where: type === 'server' ? 'Multiplayer' : 'Singleplayer' });
  if (type === 'server') { const st = loadStats(); const s = st.servers[host] || (st.servers[host] = { visits: 0, ms: 0, last: 0 }); s.visits++; s.last = Date.now(); writeJson(F.stats, st); }
}
function parseGameLine(line) {
  let m = line.match(/Connecting to ([\w.\-\[\]:]+), (\d+)/);
  if (m) return startSess('server', m[2] === '25565' ? m[1] : `${m[1]}:${m[2]}`);
  if (/Starting integrated minecraft server/.test(line)) startSess('sp');
}
function scanSP(uuid) {
  const r = { worlds: 0, playTicks: 0, deaths: 0, mobKills: 0, mined: 0 };
  const dir = path.join(ROOT, 'profiles');
  if (!fs.existsSync(dir)) return r;
  const id = (uuid || '').replace(/-/g, '').toLowerCase();
  for (const p of fs.readdirSync(dir)) {
    const saves = path.join(dir, p, 'saves');
    if (!fs.existsSync(saves)) continue;
    for (const w of fs.readdirSync(saves)) {
      if (!fs.existsSync(path.join(saves, w, 'level.dat'))) continue;
      r.worlds++;
      const sd = path.join(saves, w, 'stats');
      if (!fs.existsSync(sd)) continue;
      let files = fs.readdirSync(sd).filter(f => f.endsWith('.json'));
      const mine = files.filter(f => f.replace('.json', '').replace(/-/g, '').toLowerCase() === id);
      if (mine.length) files = mine;
      for (const f of files) {
        const j = readJson(path.join(sd, f), null), s = j && j.stats;
        if (!s) continue;
        const c = s['minecraft:custom'] || {};
        r.playTicks += c['minecraft:play_time'] || c['minecraft:play_one_minute'] || 0;
        r.deaths += c['minecraft:deaths'] || 0;
        r.mobKills += c['minecraft:mob_kills'] || 0;
        r.mined += Object.values(s['minecraft:mined'] || {}).reduce((a, b) => a + b, 0);
      }
    }
  }
  return r;
}
function myStats() {
  const s = loadSettings(), st = loadStats();
  return {
    totalMs: st.totalMs, launches: st.launches,
    servers: Object.entries(st.servers).map(([host, v]) => ({ host, ...v })).sort((a, b) => b.ms - a.ms).slice(0, 30),
    sp: { ...scanSP(s.lastUser && s.lastUser.uuid), spMs: st.spMs },
  };
}
const shared = p => ({ name: p.name, version: p.version, loader: p.loader, mods: p.extraMods, packs: p.extraPacks, modpack: p.modpack ? { slug:p.modpack.slug, title:p.modpack.title, icon:p.modpack.icon, versionId:p.modpack.versionId, versionName:p.modpack.versionName } : null });

/* ---------- community API ---------- */
async function api(method, p, body, auth = true) {
  const s = eff(loadSettings()), base = (s.apiUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Community server not configured (Settings)');
  const h = { 'Content-Type': 'application/json' };
  if (auth) { if (!mcAuth) throw new Error('Sign in online to use the community'); h.Authorization = 'Bearer ' + mcAuth.mclc().access_token; }
  const r = await fetch(base + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
  return j;
}
async function syncProfile() {
  const s = loadSettings(), st = myStats();
  return api('POST', '/api/me', {
    bio: s.bio, visibility: s.visibility,
    stats: { launcher: { totalMs: st.totalMs, launches: st.launches }, servers: st.servers, sp: st.sp },
    modpacks: s.profiles.filter(p => p.public).slice(0, 20).map(shared),
  });
}
ipcMain.handle('community', async (_e, o) => {
  try {
    if (o.action === 'sync') return { ok: true, data: await syncProfile() };
    if (o.action === 'get') return { ok: true, data: await api('GET', '/api/users/' + encodeURIComponent(o.name), null, false) };
    if (o.action === 'search') return { ok: true, data: await api('GET', '/api/users?q=' + encodeURIComponent(o.q || ''), null, false) };
    return { ok: false, error: 'Unknown action' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('my-stats', () => myStats());

/* ---------- auto update (portable + installed) ---------- */
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; return 0; };

function pickUpdateAsset(assets) {
  const list = (assets || []).filter(a => /\.exe$/i.test(a.name));
  const by = (re) => list.find(a => re.test(a.name));
  return by(/JogurtClient(?!-Setup).*\.exe$/i)
    || by(/portable/i)
    || by(/JogurtClient.*\.exe$/i)
    || by(/jogurt/i)
    || list[0]
    || null;
}

function currentExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE
    || (app.isPackaged && win32 ? process.execPath : null);
}

ipcMain.handle('check-update', async () => {
  const s = eff(loadSettings());
  if (!app.isPackaged) return { status: 'dev', version: app.getVersion() };
  if (!s.updateRepo) return { status: 'unconfigured', version: app.getVersion() };
  try {
    const j = await (await fetch(`https://api.github.com/repos/${s.updateRepo}/releases/latest`, {
      headers: { ...UA, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    })).json();
    if (!j.tag_name) return { status: 'error', error: j.message || 'No release found', version: app.getVersion() };
    const v = String(j.tag_name).replace(/^v/i, '').trim();
    if (cmp(v, app.getVersion()) <= 0) return { status: 'latest', version: app.getVersion() };
    const asset = pickUpdateAsset(j.assets);
    return {
      status: 'available',
      version: v,
      current: app.getVersion(),
      url: asset && asset.browser_download_url,
      name: asset && asset.name,
      page: j.html_url,
      notes: (j.body || '').slice(0, 500),
    };
  } catch (e) { return { status: 'error', error: String((e && e.message) || e), version: app.getVersion() }; }
});

ipcMain.handle('apply-update', async (_e, { url, page }) => {
  if (!win32) { if (page || url) shell.openExternal(page || url); return { ok: false, manual: true }; }
  const target = currentExePath();
  if (!url) { if (page) shell.openExternal(page); return { ok: false, manual: true }; }
  if (!target || !app.isPackaged) { shell.openExternal(page || url); return { ok: false, manual: true }; }
  try {
    const tmp = path.join(app.getPath('temp'), 'JogurtClient-update.exe');
    try { fs.unlinkSync(tmp); } catch {}
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
    if (!r.ok) throw new Error('Update download failed (' + r.status + ')');
    const total = +r.headers.get('content-length') || 0;
    const ws = fs.createWriteStream(tmp);
    let got = 0;
    for await (const chunk of r.body) {
      ws.write(chunk);
      got += chunk.length;
      if (total) send('update-progress', Math.min(0.99, got / total));
    }
    await new Promise(res => ws.end(res));
    send('update-progress', 1);
    if (fs.statSync(tmp).size < 1e6) throw new Error('Downloaded update looks incomplete');
    const bat = path.join(app.getPath('temp'), 'jogurt-update.bat');
    fs.writeFileSync(bat, [
      '@echo off',
      'ping 127.0.0.1 -n 3 >nul',
      ':retry',
      `move /y "${tmp}" "${target}" >nul 2>&1`,
      'if errorlevel 1 (ping 127.0.0.1 -n 2 >nul & goto retry)',
      `start "" "${target}"`,
      'del "%~f0"',
    ].join('\r\n'));
    spawn('cmd', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* ---------- misc IPC ---------- */
ipcMain.handle('discord-info', () => ({ status: rpc.status || (rpc.enabled ? 'connecting' : 'off'), hasId: /^\d{15,25}$/.test(String(CONFIG.discordClientId || '')) }));
ipcMain.handle('init', () => ({ perks: PERKS, owner: isOwner(), settings: eff(loadSettings()), root: ROOT, platform: process.platform, version: app.getVersion() }));
ipcMain.handle('apply-theme', (_e, { color, symbol, icon }) => {
  try { win.setTitleBarOverlay({ color, symbolColor: symbol, height: 40 }); } catch {}
  try { win.setBackgroundColor(color); } catch {}
  // Keep the Jogurt Client logo on the taskbar / window title bar even when UI themes change.
  try { win.setIcon(appIconPath()); } catch {}
});
ipcMain.handle('settings-set', (_e, s) => {
  s = { ...s };
  if (!isOwner()) { delete s.apiUrl; delete s.updateRepo; }
  const saved = saveSettings({ ...loadSettings(), ...s });
  if ('discord' in s) { rpc.setEnabled(saved.discord !== false); if (saved.discord !== false) updatePresence(); }
  return saved;
});
ipcMain.handle('open-folder', (_e, id) => { const d = id ? path.join(ROOT, 'profiles', id) : ROOT; fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
ipcMain.handle('repair', (_e, id) => { for (const f of ['.jogurt-state.json']) { try { fs.unlinkSync(path.join(ROOT, 'profiles', id, f)); } catch {} } return true; });


/* ---------- editable modpacks / local mod safety scan ---------- */
// Known-good mods that must never be blocked by the heuristic scanner (false-positive prone).
const SAFE_MOD_ALLOWLIST = [
  /voice.?chat/i, /simple.?voice.?chat/i, /\bvoicechat\b/i,
  /fabric.?api/i, /fabric.?language.?kotlin/i, /modmenu/i, /cloth.?config/i,
  /sodium/i, /lithium/i, /phosphor/i, /iris/i, /indium/i, /starlight/i,
  /entityculling/i, /ferritecore/i, /lazydfu/i, /smoothboot/i,
  /reeses.?sodium/i, /sodium.?extra/i, /immediatelyfast/i, /dynamic.?fps/i,
  /appleskin/i, /jade/i, /wthit/i, /xaero/i, /journey.?map/i, /mini.?hud/i,
  /litematica/i, /worldedit/i, /carpet/i, /essential/i,
];
const CHEAT_TERMS = [
  // Keep High patterns specific; avoid short tokens that appear in normal mods.
  ['High', /\b(xray|freecam|killaura|kill.?aura|aimbot|reach.?hack|triggerbot|autoclicker|auto.?clicker|scaffold.?hack|flight.?hack|fly.?hack|speed.?hack|esp.?hack|entity.?esp|chest.?esp|baritone.?combat)\b/i],
  ['Medium', /\b(hacked.?client|hack.?client|utility.?client|pvp.?client|autototem|auto.?crystal|crystal.?aura|antiknockback|packet.?fly)\b/i]
];
function isAllowlistedMod(name) {
  const s = String(name || '');
  return SAFE_MOD_ALLOWLIST.some(rx => rx.test(s));
}
function inspectModFile(filePath, displayName) {
  const reasons = [], base = displayName || path.basename(filePath);
  // Popular legitimate mods: skip heuristic block (still hash them).
  if (isAllowlistedMod(base) || isAllowlistedMod(path.basename(filePath))) {
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return { name: base, sha256, status: 'clear', reasons: [], allowlisted: true };
  }
  for (const [level, rx] of CHEAT_TERMS) if (rx.test(base)) reasons.push({ level, reason: `Name matches ${level.toLowerCase()}-risk cheat terminology` });
  try {
    const zip = new AdmZip(filePath);
    // Prefer mod id from fabric.mod.json / mods.toml for allowlist check.
    try {
      const fm = zip.getEntry('fabric.mod.json');
      if (fm) {
        const meta = JSON.parse(fm.getData().toString('utf8'));
        const id = [meta.id, meta.name, meta.modid].filter(Boolean).join(' ');
        if (isAllowlistedMod(id)) {
          const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
          return { name: base, sha256, status: 'clear', reasons: [], allowlisted: true };
        }
      }
    } catch {}
    const names = zip.getEntries().map(e => e.entryName).join('\n');
    // Only scan small text/metadata files — not class bytecode (too many false positives).
    const textFiles = zip.getEntries().filter(e => /\.(json|txt|mf|properties|md)$/i.test(e.entryName)).slice(0, 40);
    const text = textFiles.map(e => { try { return e.getData().toString('utf8').slice(0, 8000); } catch { return ''; } }).join('\n');
    const sample = names + '\n' + text;
    for (const [level, rx] of CHEAT_TERMS) if (rx.test(sample) && !reasons.some(r => r.level === level)) reasons.push({ level, reason: `Archive metadata or bundled text matches ${level.toLowerCase()}-risk terminology` });
    if (!zip.getEntry('fabric.mod.json') && !zip.getEntry('META-INF/mods.toml') && !zip.getEntry('mcmod.info')) reasons.push({ level: 'Review', reason: 'No common mod metadata file found; this may not be a standard Minecraft mod' });
  } catch { reasons.push({ level: 'Review', reason: 'Could not inspect as a readable JAR/ZIP archive' }); }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return { name: base, sha256, status: reasons.some(r => r.level === 'High') ? 'blocked' : reasons.length ? 'review' : 'clear', reasons };
}
ipcMain.handle('import-mrpack', async () => {
  try {
    const pick = await dialog.showOpenDialog(win, { title: 'Import Modrinth modpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }, { name: 'ZIP archive', extensions: ['zip'] }], properties: ['openFile'] });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    const zip = new AdmZip(pick.filePaths[0]);
    if (!zip.getEntry('modrinth.index.json')) throw new Error('This archive does not contain modrinth.index.json.');
    const index = JSON.parse(zip.readAsText('modrinth.index.json'));
    const highRx = CHEAT_TERMS.filter(([level]) => level === 'High').map(([, rx]) => rx);
    const suspicious = (index.files || []).map(f => String(f.path || '')).filter(n => {
      if (isAllowlistedMod(n) || isAllowlistedMod(path.basename(n))) return false;
      return highRx.some(rx => rx.test(n));
    });
    if (suspicious.length) throw new Error('Import blocked: the modpack contains file names matching cheat-mod indicators: ' + suspicious.slice(0,4).join(', '));
    if (!index.dependencies || !index.dependencies.minecraft || !index.dependencies['fabric-loader']) throw new Error('Only Fabric Modrinth modpacks are supported right now.');
    const id = crypto.randomBytes(8).toString('hex'), importDir = path.join(ROOT, 'imports');
    fs.mkdirSync(importDir, { recursive: true });
    const dest = path.join(importDir, id + '.mrpack');
    fs.copyFileSync(pick.filePaths[0], dest);
    const settings = loadSettings();
    const files = index.files || [];
    // Prefer counting actual client mod JARs; fall back to total indexed files.
    const modJarCount = files.filter(f => {
      const p = String(f.path || '');
      if (f.env && f.env.client === 'unsupported') return false;
      return /^mods\/.+\.jar$/i.test(p) || /\.jar$/i.test(p);
    }).length;
    const fileCount = modJarCount || files.length;
    const profile = normProfile({ id, name: String(index.name || path.basename(pick.filePaths[0], path.extname(pick.filePaths[0]))).slice(0,64), version: index.dependencies.minecraft, loader: 'fabric', ram: 6, perks: {}, extraMods: [], extraPacks: [], localMods: [], public: false, modpack: { title: index.name || 'Imported Modrinth pack', localPath: dest, imported: true, versionName: index.versionId || '', fileCount } });
    settings.profiles.push(profile); settings.active = id; saveSettings(settings);
    send('settings', eff(settings));
    return { ok: true, profile, fileCount };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('add-local-mods', async (_e, { profileId, paths }) => {
  try {
    const settings = loadSettings(), profile = settings.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Modpack not found');
    const modsDir = path.join(ROOT, 'local-mods', profileId);
    fs.mkdirSync(modsDir, { recursive: true });
    profile.localMods = profile.localMods || [];
    const results = [];
    for (const source of (paths || []).slice(0, 40)) {
      if (typeof source !== 'string' || !/\.jar$/i.test(source) || !fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
      const original = path.basename(source).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetName = `${crypto.randomBytes(3).toString('hex')}_${original}`;
      const target = path.join(modsDir, targetName);
      fs.copyFileSync(source, target);
      const scan = inspectModFile(target, original);
      if (scan.status === 'blocked') { fs.unlinkSync(target); results.push({ ...scan, removed: true }); continue; }
      profile.localMods.push({ name: original, file: targetName, sha256: scan.sha256, scan });
      results.push({ ...scan, removed: false });
    }
    saveSettings(settings);
    send('settings', eff(settings));
    return { ok: true, results, localMods: profile.localMods };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('remove-local-mod', (_e, { profileId, file }) => {
  try {
    const settings = loadSettings(), profile = settings.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Modpack not found');
    const item = (profile.localMods || []).find(m => m.file === file);
    if (!item) throw new Error('Mod not found');
    // Local JARs live under local-mods/<profileId>/, not profiles/<id>/mods
    const target = safe(path.join(ROOT, 'local-mods', profileId), file);
    try { fs.unlinkSync(target); } catch {}
    profile.localMods = profile.localMods.filter(m => m.file !== file);
    saveSettings(settings);
    send('settings', eff(settings));
    return { ok: true, localMods: profile.localMods };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('versions', async () => {
  const s = loadSettings();
  let m; try { m = await getManifest(); } catch { return { versions: [], fabric: [] }; }
  let fabric = readJson(F.cache, {}).fabric || [];
  try { fabric = (await (await fetch('https://meta.fabricmc.net/v2/versions/game', { headers: UA, signal: AbortSignal.timeout(6000) })).json()).map(v => v.version); writeJson(F.cache, { ...readJson(F.cache, {}), fabric }); } catch {}
  return { versions: m.versions.filter(v => v.type === 'release' || (s.snapshots && v.type === 'snapshot')).map(v => v.id), fabric };
});

ipcMain.handle('search-mods', async (_e, { query, version, type }) => {
  try {
    const t = type || 'mod';
    const facets = [[`project_type:${t}`]];
    if (t !== 'resourcepack') facets.push(['categories:fabric']);
    if (version && t !== 'modpack') facets.push([`versions:${version}`]);
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=14&index=downloads&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    const j = await (await fetch(url, { headers: UA })).json();
    return j.hits.filter(h => !CHEAT_TERMS.some(([level,rx]) => level === 'High' && rx.test([h.slug,h.title,h.description].join(' '))))
      .map(h => ({ slug: h.slug, title: h.title, desc: h.description, icon: h.icon_url, downloads: h.downloads }));
  } catch { return []; }
});
ipcMain.handle('modpack-info', async (_e, slug) => {
  try {
    const vs = await (await fetch(`https://api.modrinth.com/v2/project/${slug}/version?loaders=${encodeURIComponent('["fabric"]')}`, { headers: UA })).json();
    if (!vs.length) return null;
    const v = vs[0];
    return { versionId: v.id, versionName: v.version_number || v.name, mc: v.game_versions[v.game_versions.length - 1] };
  } catch { return null; }
});

/* ---------- skin ---------- */
const skinCache = new Map();
async function fetchSkin(uuid) {
  if (skinCache.has(uuid)) return skinCache.get(uuid);
  let url = null, model = 'default';
  try {
    const j = await (await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, { headers: UA })).json();
    const tex = JSON.parse(Buffer.from(j.properties.find(p => p.name === 'textures').value, 'base64').toString()).textures;
    url = tex.SKIN.url; model = tex.SKIN.metadata && tex.SKIN.metadata.model === 'slim' ? 'slim' : 'default';
  } catch {
    const sk = mcAuth && mcAuth.profile.id === uuid && ((mcAuth.profile.skins || []).find(s => s.state === 'ACTIVE') || (mcAuth.profile.skins || [])[0]);
    if (sk) { url = sk.url; model = sk.variant === 'SLIM' ? 'slim' : 'default'; }
  }
  if (!url) return null;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const r = { data: 'data:image/png;base64,' + buf.toString('base64'), model };
  skinCache.set(uuid, r);
  return r;
}
const myUuid = () => (mcAuth && mcAuth.profile.id) || (loadSettings().lastUser || {}).uuid;
ipcMain.handle('skin', async (_e, uuid) => { try { const u = uuid || myUuid(); return u ? await fetchSkin(u) : null; } catch { return null; } });
ipcMain.handle('change-skin', async (_e, variant) => {
  try {
    if (!mcAuth) throw new Error('Sign in online to change your skin');
    const r = await dialog.showOpenDialog(win, { title: 'Choose a skin (64x64 PNG)', filters: [{ name: 'PNG', extensions: ['png'] }], properties: ['openFile'] });
    if (r.canceled) return { ok: false, canceled: true };
    const form = new FormData();
    form.append('variant', variant === 'slim' ? 'slim' : 'classic');
    form.append('file', new Blob([fs.readFileSync(r.filePaths[0])], { type: 'image/png' }), 'skin.png');
    const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { Authorization: `Bearer ${mcAuth.mclc().access_token}` }, body: form });
    if (!res.ok) throw new Error(`Mojang rejected the skin (${res.status})`);
    skinCache.delete(mcAuth.profile.id);
    return { ok: true, skin: await fetchSkin(mcAuth.profile.id) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

/* ---------- login ---------- */
async function finishLogin(xbox) {
  const mc = await xbox.getMinecraft();
  mcAuth = mc;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(F.session, xbox.save());
  const s = loadSettings(); s.lastUser = { name: mc.profile.name, uuid: mc.profile.id }; saveSettings(s);
  return { name: mc.profile.name, uuid: mc.profile.id };
}
ipcMain.handle('auto-login', async () => {
  const s = loadSettings();
  try {
    if (!fs.existsSync(F.session)) return null;
    return await finishLogin(await authManager.refresh(fs.readFileSync(F.session, 'utf8')));
  } catch {
    if (s.lastUser) { mcAuth = null; return { ...s.lastUser, offline: true }; } // offline: play installed modpacks
    return null;
  }
});
ipcMain.handle('login', async () => {
  try { return { ok: true, user: await finishLogin(await authManager.launch('electron')) }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('logout', () => { mcAuth = null; try { fs.unlinkSync(F.session); } catch {} const s = loadSettings(); s.lastUser = null; saveSettings(s); return true; });

/* ---------- launch ---------- */
ipcMain.handle('launch', async (_e, { profileId }) => {
  if (running) return { ok: false, error: 'Already running' };
  running = true;
  try {
    const s = loadSettings();
    const prof = s.profiles.find(p => p.id === profileId);
    if (!prof) throw new Error('Modpack not found');
    setPresence({ phase: 'prep', name: prof.name, version: prof.version || '', where: '' });
    const gameDir = path.join(ROOT, 'profiles', prof.id);
    fs.mkdirSync(gameDir, { recursive: true });
    const stateFile = path.join(gameDir, '.jogurt-state.json');
    const state = readJson(stateFile, null);
    const online = await isOnline();
    const perkSlugs = PERKS.filter(p => (prof.perks || {})[p.id] !== false).map(p => p.slug);
    const key = crypto.createHash('sha1').update(JSON.stringify([prof.version, prof.loader, prof.modpack && prof.modpack.versionId, prof.modpack ? [] : perkSlugs, prof.modpack ? [] : prof.extraMods.map(m => m.slug), prof.extraPacks.map(m => m.slug), (prof.localMods||[]).map(m => m.name+':'+m.sha256)])).digest('hex');
    const fast = !!(state && state.key === key && (!state.custom || fs.existsSync(path.join(ROOT, 'versions', state.custom, state.custom + '.json'))));
    let version, custom, java, major;

    if (fast && (state.played || online)) {
      // Already downloaded once: skip every install step (works offline after the first full launch)
      version = state.mc; custom = state.custom; major = state.javaMajor;
      java = findJava(major) || (online ? await ensureJava(major) : null);
      if (!java) throw new Error('Java runtime is missing. Connect to the internet once to restore it.');
      stage('Starting...', 30);
    } else {
      if (!online) throw new Error('Internet is needed the first time you play a modpack. After that it works offline.');
      let loaderVer = null;
      version = prof.version;
      if (prof.modpack) {
        const info = await installModpack(prof, gameDir);
        version = info.mc; loaderVer = info.loader;
        if (prof.version !== version || prof.loader !== 'fabric') { prof.version = version; prof.loader = 'fabric'; saveSettings(s); send('settings', eff(s)); }
      }
      if (!version) throw new Error('Pick a Minecraft version first');
      major = await javaMajorFor(version);
      java = await ensureJava(major);
      if (prof.loader === 'fabric') { stage('Installing Fabric...', 33); custom = await installFabric(version, loaderVer); }
      {
        const mods = path.join(gameDir, 'mods');
        fs.mkdirSync(mods, { recursive: true });
        if (!prof.modpack) cleanJogurt(mods);
        if (prof.loader === 'fabric') {
          const list = [...(!prof.modpack ? ['fabric-api', ...perkSlugs] : []), ...prof.extraMods.map(m => m.slug)];
          const seen = new Set(); let i = 0;
          for (const slug of list) { stage(`Downloading mods (${++i}/${list.length})...`, 12 + (i / Math.max(1,list.length)) * 20); await installProject(slug, version, seen, mods, ['fabric']); }
        }
      }
      const packs = path.join(gameDir, 'resourcepacks');
      cleanJogurt(packs);
      const seenP = new Set();
      for (const p of prof.extraPacks) { stage('Downloading resource packs...', 34); await installProject(p.slug, version, seenP, packs, null); }
      const localDir = path.join(ROOT, 'local-mods', prof.id), gameMods = path.join(gameDir, 'mods');
      fs.mkdirSync(gameMods, { recursive: true });
      for (const lm of (prof.localMods || [])) {
        const src = safe(localDir, lm.file), dst = safe(gameMods, lm.file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      }
      writeJson(stateFile, { key, mc: version, custom, javaMajor: major, played: !!(state && state.key === key && state.played) });
    }

    const localDir = path.join(ROOT, 'local-mods', prof.id), gameMods = path.join(gameDir, 'mods');
    fs.mkdirSync(gameMods, { recursive: true });
    for (const lm of (prof.localMods || [])) {
      const src = safe(localDir, lm.file), dst = safe(gameMods, lm.file);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    }
    stage('Preparing game files...', 36);
    setPresence({ version });
    try { uiPack.install({ assetsDir: path.join(__dirname, 'assets', 'ingame'), gameDir, version, enabled: s.ingameUi !== false }); }
    catch (e) { log('Jogurt UI pack skipped: ' + (e && e.message || e)); }
    try { installJogurtTitleMod(gameDir, version); }
    catch (e) { log('Jogurt title mod skipped: ' + (e && e.message || e)); }
    const authorization = mcAuth ? mcAuth.mclc() : await Authenticator.getAuth((s.lastUser && s.lastUser.name) || 'Player');
    if (!mcAuth) log('Offline mode: signed-out account, singleplayer only.');
    const useCustom = custom || (!online ? version : undefined);
    const launcher = new Client();
    let started = false, tPlay = 0;
    launcher.on('progress', p => { if (p.total) stage('Downloading game files...', 36 + (p.task / p.total) * 60); });
    launcher.on('debug', m => log(m));
    launcher.on('data', m => {
      const text = String(m); log(text);
      text.split(/\r?\n/).forEach(parseGameLine);
      if (!started) {
        started = true; tPlay = Date.now(); stage('Playing', 100); send('state', 'playing');
        setPresence({ phase: 'playing', since: tPlay, where: '' });
        writeJson(stateFile, { ...readJson(stateFile, {}), played: true });
        const st = loadStats(); st.launches++; writeJson(F.stats, st);
      }
    });
    launcher.on('close', async c => {
      running = false; endSess();
      if (tPlay) { const st = loadStats(); st.totalMs += Date.now() - tPlay; writeJson(F.stats, st); }
      log(`Game closed (code ${c})`); send('state', 'idle'); stage('', 0);
      setPresence({ phase: 'idle', where: '' });
      if (eff(loadSettings()).apiUrl && mcAuth && tPlay) { try { await syncProfile(); send('synced', true); } catch {} }
    });
    // Modrinth-style launch: independent javaw process + standard launcher properties
    // so external software can detect the Minecraft instance (window title, process, hsperfdata).
    const launcherArgs = [
      `-Dminecraft.launcher.brand=Jogurt-Client`,
      `-Dminecraft.launcher.version=${app.getVersion()}`,
    ];
    const jvmArgs = [...launcherArgs, ...(s.jvmflags ? JVM_FLAGS : [])];
    // Prefer javaw on Windows even if findJava returned java.exe
    let javaPath = java;
    if (win32 && javaPath && /java\.exe$/i.test(javaPath)) {
      const jw = javaPath.replace(/java\.exe$/i, 'javaw.exe');
      if (fs.existsSync(jw)) javaPath = jw;
    }
    launcher.launch({
      authorization, root: ROOT, javaPath,
      version: { number: version, type: /^\d+(\.\d+)*$/.test(version) ? 'release' : 'snapshot', custom: useCustom },
      memory: { max: `${prof.ram || 4}G`, min: '1G' },
      // detached:true matches Modrinth/official — process is independent of the launcher.
      overrides: { gameDirectory: gameDir, detached: true },
      window: s.fullscreen ? { fullscreen: true } : undefined,
      customArgs: jvmArgs,
    });
    return { ok: true };
  } catch (e) { running = false; stage('', 0); setPresence({ phase: 'idle', where: '' }); return { ok: false, error: String((e && e.message) || e) }; }
});

app.whenReady().then(() => { createWindow(); rpc.setEnabled(loadSettings().discord !== false); updatePresence(); });
app.on('before-quit', () => { try { rpc.clear(); rpc.close(); } catch {} });
app.on('window-all-closed', () => app.quit());
