/**
 * Jogurt Client Setup — Electron installer with the same UI language as the app.
 * - Detects existing installs and offers Update / Repair
 * - Copies payload from resources/payload (built client) into the chosen folder
 * - Does NOT touch %APPDATA%\.jogurtclient (profiles stay)
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const TARGET_VERSION = app.getVersion();
const PRODUCT = 'Jogurt Client';
const EXE_NAME = 'JogurtClient.exe';

let win;

function defaultInstallDir() {
  // Per-user install (no admin): %LOCALAPPDATA%\Jogurt Client
  return path.join(process.env.LOCALAPPDATA || app.getPath('appData'), PRODUCT);
}

function payloadDir() {
  // Packaged: resources/payload   Dev: ../dist/win-unpacked
  const packaged = path.join(process.resourcesPath || '', 'payload');
  if (fs.existsSync(path.join(packaged, EXE_NAME))) return packaged;
  const dev = path.join(__dirname, '..', 'dist', 'win-unpacked');
  if (fs.existsSync(path.join(dev, EXE_NAME))) return dev;
  return packaged;
}

function readInstalledVersion(dir) {
  try {
    const pkg = path.join(dir, 'resources', 'app.asar');
    // Version file we write on install
    const marker = path.join(dir, 'version.json');
    if (fs.existsSync(marker)) {
      return JSON.parse(fs.readFileSync(marker, 'utf8')).version || null;
    }
  } catch {}
  // Fallback: exe exists counts as installed, version unknown
  return null;
}

function isInstalled(dir) {
  return fs.existsSync(path.join(dir, EXE_NAME));
}

function sendProgress(text, pct) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', { text, pct });
}

function copyRecursive(src, dest, onFile) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name), onFile);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (onFile) onFile(src);
  }
}

function countFiles(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    n += fs.statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 580,
    minWidth: 440,
    minHeight: 520,
    frame: false,
    resizable: false,
    backgroundColor: '#0a0c0b',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('win-min', () => win && win.minimize());
ipcMain.handle('win-close', () => app.quit());

ipcMain.handle('get-install-info', () => {
  const installPath = defaultInstallDir();
  const installed = isInstalled(installPath);
  return {
    installed,
    installPath,
    currentVersion: installed ? readInstalledVersion(installPath) : null,
    targetVersion: TARGET_VERSION,
  };
});

ipcMain.handle('pick-folder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose install folder',
    defaultPath: current || defaultInstallDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('install', async (_e, { path: installPath }) => {
  try {
    const dest = installPath || defaultInstallDir();
    const src = payloadDir();
    if (!fs.existsSync(path.join(src, EXE_NAME)) && !fs.existsSync(src)) {
      return { ok: false, error: 'Install payload missing. Build the client (dist/win-unpacked) first, then build the setup app.' };
    }
    const updated = isInstalled(dest);
    fs.mkdirSync(dest, { recursive: true });

    // If payload is a full win-unpacked tree, copy it.
    const total = Math.max(1, countFiles(src));
    let done = 0;
    sendProgress(updated ? 'Updating files…' : 'Copying files…', 2);
    copyRecursive(src, dest, () => {
      done++;
      const pct = 2 + Math.floor((done / total) * 90);
      if (done % 5 === 0 || done === total) sendProgress(updated ? 'Updating files…' : 'Installing…', pct);
    });

    // Version marker for next update check
    fs.writeFileSync(path.join(dest, 'version.json'), JSON.stringify({
      version: TARGET_VERSION,
      product: PRODUCT,
      updatedAt: new Date().toISOString(),
    }, null, 2));

    // Start menu shortcut (best-effort, Windows)
    try {
      const shortcutDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      fs.mkdirSync(shortcutDir, { recursive: true });
      // Electron doesn't create .lnk easily without shell; write a small cmd launcher as fallback
      const cmd = path.join(dest, 'Launch Jogurt Client.cmd');
      fs.writeFileSync(cmd, `@echo off\r\nstart "" "%~dp0${EXE_NAME}"\r\n`);
    } catch {}

    sendProgress(updated ? 'Update complete' : 'Install complete', 100);
    return { ok: true, updated, path: dest };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('launch-app', () => {
  const dir = defaultInstallDir();
  const exe = path.join(dir, EXE_NAME);
  if (!fs.existsSync(exe)) return { ok: false };
  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: dir }).unref();
  app.quit();
  return { ok: true };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
