'use strict'
/** Окно управления: состояние приложения и действия — только через эти вызовы. */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('titan', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  pairWithCode: (host, code) => ipcRenderer.invoke('pair:code', { host, code }),
  setDisplay: (id) => ipcRenderer.invoke('display:set', id),
  setRotation: (rotation) => ipcRenderer.invoke('rotation:set', rotation),
  identify: () => ipcRenderer.invoke('identify'),
  reloadTv: () => ipcRenderer.invoke('tv:reload'),
  unpair: () => ipcRenderer.invoke('unpair'),
  setAutostart: (on) => ipcRenderer.invoke('autostart:set', on),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
})
