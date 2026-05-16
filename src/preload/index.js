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
    loadSchema: (applianceKey) => renderer.invoke('schema:load', applianceKey),
    loadOptions: (applianceKey) => renderer.invoke('option:load', applianceKey),
    saveOption: (applianceKey, optionPayload) => renderer.invoke('option:save', applianceKey, optionPayload),
    deleteOption: (applianceKey, optionId) => renderer.invoke('option:delete', applianceKey, optionId),
    loadPresets: (applianceKey) => renderer.invoke('preset:load', applianceKey),
    savePreset: (applianceKey, presetPayload) => renderer.invoke('preset:save', applianceKey, presetPayload),
    deletePreset: (applianceKey, presetId) => renderer.invoke('preset:delete', applianceKey, presetId)
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
