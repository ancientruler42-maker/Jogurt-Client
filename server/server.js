// Jogurt community server. Zero dependencies (Node 18+).
// Run:  node server.js     (PORT, DB_FILE env vars optional)
// Users prove who they are with their Minecraft access token, which this server checks with Mojang.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const DB = process.env.DB_FILE || path.join(__dirname, 'data.json');
const DEV = process.env.DEV_NO_VERIFY === '1'; // tests only: token = "uuid:name"

let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let dirty = false;
setInterval(() => { if (!dirty) return; fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); dirty = false; }, 3000);

const tokens = new Map(), hits = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of tokens) if (v.exp < n) tokens.delete(k); hits.clear(); }, 60000);

async function verify(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return null;
  if (DEV) { const [uuid, name] = t.split(':'); return uuid && name ? { uuid, name } : null; }
  const c = tokens.get(t);
  if (c && c.exp > Date.now()) return c;
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return null;
  const j = await r.json();
  const v = { uuid: j.id, name: j.name, exp: Date.now() + 10 * 60000 };
  tokens.set(t, v);
  return v;
}

const str = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const num = n => (Number.isFinite(+n) && +n >= 0 ? Math.min(+n, 1e13) : 0);
const slug = s => (/^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '');
const url = s => (/^https:\/\/cdn\.modrinth\.com\//.test(s) ? str(s, 300) : '');
const items = a => (Array.isArray(a) ? a : []).slice(0, 200).map(x => ({ slug: slug(x && x.slug), title: str(x && x.title, 60), icon: url(x && x.icon) })).filter(x => x.slug);

function clean(b) {
  const v = b.visibility || {}, st = b.stats || {}, L = st.launcher || {}, sp = st.sp || {};
  return {
    bio: str(b.bio, 200),
    visibility: { servers: !!v.servers, singleplayer: !!v.singleplayer, modpacks: !!v.modpacks },
    stats: {
      launcher: { totalMs: num(L.totalMs), launches: num(L.launches) },
      servers: (Array.isArray(st.servers) ? st.servers : []).slice(0, 30).map(s => ({ host: str(s.host, 60), visits: num(s.visits), ms: num(s.ms), last: num(s.last) })),
      sp: { worlds: num(sp.worlds), playTicks: num(sp.playTicks), deaths: num(sp.deaths), mobKills: num(sp.mobKills), mined: num(sp.mined), spMs: num(sp.spMs) },
    },
    modpacks: (Array.isArray(b.modpacks) ? b.modpacks : []).slice(0, 20).map(m => {
      const mp = m.modpack;
      return {
        name: str(m.name, 40), version: str(m.version, 24), loader: m.loader === 'vanilla' ? 'vanilla' : 'fabric',
        mods: items(m.mods), packs: items(m.packs),
        modpack: mp && slug(mp.slug) ? { slug: slug(mp.slug), title: str(mp.title, 60), icon: url(mp.icon), versionId: str(mp.versionId, 16), versionName: str(mp.versionName, 30) } : null,
      };
    }),
  };
}

function view(u) {
  const o = { name: u.name, uuid: u.uuid, bio: u.bio, createdAt: u.createdAt, updatedAt: u.updatedAt, stats: { launcher: u.stats.launcher } };
  if (u.visibility.servers) o.stats.servers = u.stats.servers;
  if (u.visibility.singleplayer) o.stats.sp = u.stats.sp;
  o.modpacks = u.visibility.modpacks ? u.modpacks : [];
  return o;
}

const send = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 262144) { no(new Error('too large')); req.destroy(); } }); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { no(e); } }); });

http.createServer(async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
    if (n > 120) return send(res, 429, { error: 'Too many requests' });
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && u.pathname === '/api/health') return send(res, 200, { ok: true, users: Object.keys(db.users).length });
    if (req.method === 'POST' && u.pathname === '/api/me') {
      const who = await verify(req);
      if (!who) return send(res, 401, { error: 'Invalid or expired Minecraft login' });
      const old = db.users[who.uuid];
      const rec = { uuid: who.uuid, name: who.name, createdAt: old ? old.createdAt : Date.now(), updatedAt: Date.now(), ...clean(await body(req)) };
      db.users[who.uuid] = rec; dirty = true;
      return send(res, 200, { ok: true, created: !old, profile: view(rec) });
    }
    if (req.method === 'GET' && u.pathname === '/api/users') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const list = Object.values(db.users).filter(x => !q || x.name.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20).map(x => ({ name: x.name, uuid: x.uuid }));
      return send(res, 200, { users: list });
    }
    const m = u.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const k = decodeURIComponent(m[1]).toLowerCase().replace(/-/g, '');
      const rec = Object.values(db.users).find(x => x.name.toLowerCase() === k || x.uuid.toLowerCase() === k);
      return rec ? send(res, 200, view(rec)) : send(res, 404, { error: 'User not found' });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 400, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log('Jogurt server on :' + PORT));
