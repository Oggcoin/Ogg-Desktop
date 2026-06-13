const { ipcRenderer } = require('electron')

// Expose electronAPI - contextIsolation is false so we assign directly to window
window.electronAPI = {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  rpcCall: (url, body) => ipcRenderer.invoke('rpc-call', url, body),
  httpGet: (url) => ipcRenderer.invoke('http-get', url),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
}
console.log('[preload] electronAPI ready')
