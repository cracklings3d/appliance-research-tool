const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  onUpdateCounter: (callback) => {
    ipcRenderer.on('update-counter', (_event, value) => callback(value))
  }
})
