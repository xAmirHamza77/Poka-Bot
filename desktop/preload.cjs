const { contextBridge, ipcRenderer } = require('electron');
const desktopAPI = Object.freeze({
  version: process.argv.find(arg => arg.startsWith('--poka-version='))?.slice(15) || '',
  remote: process.argv.includes('--poka-remote=true'),
  serverUrl: process.argv.find(arg => arg.startsWith('--poka-server='))?.slice(14) || '',
  connectServer: url => ipcRenderer.invoke('server:connect', url),
  platform: process.platform,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  signIn: () => ipcRenderer.invoke('session:sign-in'),
});
contextBridge.exposeInMainWorld("pokaDesktop", desktopAPI);
// Compatibility for hosted UI versions already installed.
contextBridge.exposeInMainWorld("openDotsDesktop", desktopAPI);
