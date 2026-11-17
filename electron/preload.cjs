const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kidsPlayAdmin', Object.freeze({
  getBackend: () => ipcRenderer.invoke('kidsplay-admin:get-backend'),
  setBackend: apiBaseUrl => ipcRenderer.invoke('kidsplay-admin:set-backend', apiBaseUrl),
  request: request => ipcRenderer.invoke('kidsplay-admin:request', request),
}))
