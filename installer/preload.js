const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('installer', {
  getInstallInfo: () => ipcRenderer.invoke('get-install-info'),
  pickFolder: (current) => ipcRenderer.invoke('pick-folder', current),
  install: (opts) => ipcRenderer.invoke('install', opts),
  launchApp: () => ipcRenderer.invoke('launch-app'),
  minimize: () => ipcRenderer.invoke('win-min'),
  close: () => ipcRenderer.invoke('win-close'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
