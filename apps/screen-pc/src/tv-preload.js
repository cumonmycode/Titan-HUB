'use strict'
/**
 * Окно показа. В самом окне (tv.html) — связь с приложением: что показывать и с каким
 * поворотом, сообщение на ТВ, «перезагрузи страницу». Внутри iframe — мост TitanMenu,
 * как у приставки: страница показа раз в 5 с отмечается (сторож перезагрузит её, если
 * она замолчит).
 */
const { contextBridge, ipcRenderer } = require('electron')

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('tvHost', {
    getConfig: () => ipcRenderer.invoke('tv:get-config'),
    onConfig: (cb) => ipcRenderer.on('tv:config', (_e, c) => cb(c)),
    onMessage: (cb) => ipcRenderer.on('tv:message', (_e, m) => cb(m)),
    onReload: (cb) => ipcRenderer.on('tv:reload', () => cb()),
    onFailed: (cb) => ipcRenderer.on('tv:failed', () => cb()),
  })
} else {
  contextBridge.exposeInMainWorld('TitanMenu', {
    alive: () => ipcRenderer.send('tv:alive'),
    now: () => Date.now(),
  })
}
