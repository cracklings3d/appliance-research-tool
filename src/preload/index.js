const { contextBridge, ipcRenderer } = require('electron')

function createElectronApi({
  platform = process.platform,
  versions = process.versions,
  ipcRenderer: renderer = ipcRenderer
} = {}) {
  return {
    platform,
    versions: {
      node: versions.node,
      chrome: versions.chrome,
      electron: versions.electron
    },
    onUpdateCounter: (callback) => {
      renderer.on('update-counter', (_event, value) => callback(value))
    },
    listSchemas: () => renderer.invoke('schema:list'),
    loadSchema: (applianceKey) => renderer.invoke('schema:load', applianceKey)
  }
}

function exposeElectronApi({ bridge = contextBridge, electronApi = createElectronApi() } = {}) {
  bridge.exposeInMainWorld('electronAPI', electronApi)
  return electronApi
}

exposeElectronApi()

module.exports = {
  createElectronApi,
  exposeElectronApi
}
