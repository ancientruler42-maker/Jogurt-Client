// Minimal Discord Rich Presence client (no npm packages).
// Talks to the local Discord app over its IPC pipe/socket, the same way the official RPC does.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePaths(i) {
  if (process.platform === 'win32') return [`\\\\?\\pipe\\discord-ipc-${i}`];
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
  const out = [];
  for (const b of bases) {
    out.push(path.join(b, `discord-ipc-${i}`));
    out.push(path.join(b, 'snap.discord', `discord-ipc-${i}`));
    out.push(path.join(b, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
  }
  return out;
}

const encode = (op, data) => {
  const body = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

function tryConnect(p) {
  return new Promise(res => {
    const s = net.createConnection(p);
    const fail = () => { s.destroy(); res(null); };
    s.once('connect', () => { s.removeListener('error', fail); res(s); });
    s.once('error', fail);
  });
}

class DiscordPresence {
  constructor(clientId, onStatus) {
    this.clientId = clientId;
    this.onStatus = onStatus || (() => {});
    this.enabled = false;
    this.activity = null;
    this.sock = null;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.timer = null;
    this.connecting = false;
    this.status = '';
  }

  setStatus(s) { if (s !== this.status) { this.status = s; this.onStatus(s); } }

  /** Turn presence on or off. */
  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) { this.clear(); this.close(); this.setStatus('off'); return; }
    this.connect();
  }

  /** Set (or replace) what is shown on the Discord profile. null clears it. */
  set(activity) {
    this.activity = activity;
    if (this.enabled && this.ready) this.push();
  }

  clear() {
    this.activity = null;
    if (this.ready) this.push();
  }

  async connect() {
    if (!this.enabled || this.connecting || this.sock) return;
    if (!/^\d{15,25}$/.test(String(this.clientId || ''))) { this.setStatus('noid'); return; }
    this.connecting = true;
    let s = null;
    for (let i = 0; i < 10 && !s; i++) for (const p of pipePaths(i)) { s = await tryConnect(p); if (s) break; }
    this.connecting = false;
    if (!this.enabled) { if (s) s.destroy(); return; }
    if (!s) { this.setStatus('nodiscord'); return this.retry(); }
    this.sock = s; this.buf = Buffer.alloc(0); this.ready = false;
    s.on('data', d => this.onData(d));
    s.on('close', () => { this.sock = null; this.ready = false; if (this.enabled) { this.setStatus('nodiscord'); this.retry(); } });
    s.on('error', () => {});
    s.write(encode(OP.HANDSHAKE, { v: 1, client_id: String(this.clientId) }));
  }

  retry() {
    clearTimeout(this.timer);
    if (!this.enabled) return;
    this.timer = setTimeout(() => this.connect(), 15000);
    if (this.timer.unref) this.timer.unref();
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) return;
      let msg = null;
      try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString()); } catch {}
      this.buf = this.buf.slice(8 + len);
      if (op === OP.PING && this.sock) this.sock.write(encode(OP.PONG, msg || {}));
      else if (op === OP.CLOSE) { this.setStatus('error'); this.close(); this.retry(); }
      else if (msg && msg.evt === 'READY') { this.ready = true; this.setStatus('connected'); this.push(); }
      else if (msg && msg.evt === 'ERROR') this.setStatus('error');
    }
  }

  push() {
    if (!this.sock || !this.ready) return;
    this.sock.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: this.activity || undefined },
      nonce: crypto.randomUUID(),
    }));
  }

  close() {
    clearTimeout(this.timer);
    if (this.sock) { try { this.sock.end(); this.sock.destroy(); } catch {} }
    this.sock = null; this.ready = false;
  }
}

module.exports = { DiscordPresence, encode };
