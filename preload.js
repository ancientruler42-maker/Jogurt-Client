const { contextBridge, ipcRenderer: ipc, webUtils } = require('electron');
const call = ch => (a) => ipc.invoke(ch, a);
contextBridge.exposeInMainWorld('jogurt', {
  init: call('init'), setSettings: call('settings-set'), versions: call('versions'),
  // Electron 33 removed the non-standard File.path property. Resolve dropped files in preload.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  searchMods: call('search-mods'), modpackInfo: call('modpack-info'), importMrpack: call('import-mrpack'), addLocalMods: call('add-local-mods'), removeLocalMod: call('remove-local-mod'),
  skin: call('skin'), changeSkin: call('change-skin'),
  autoLogin: call('auto-login'), login: call('login'), logout: call('logout'),
  launch: call('launch'), openFolder: call('open-folder'), repair: call('repair'),
  applyTheme: call('apply-theme'), myStats: call('my-stats'), community: call('community'),
  discordInfo: call('discord-info'),
  checkUpdate: call('check-update'), applyUpdate: call('apply-update'),
  on: (ch, cb) => ipc.on(ch, (_e, d) => cb(d)),
});
