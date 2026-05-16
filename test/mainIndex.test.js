const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { loadCommonJsModule } = require('./helpers/loadCommonJsModule')

test('main process registers schema IPC handlers explicitly', () => {
  const handledChannels = []
  const storageInstance = {
    listSchemas: async () => ({ schemas: [], warnings: [] }),
    loadSchema: async (applianceKey) => ({
      ok: true,
      schema: { appliance: applianceKey },
      warnings: [],
      failure: null
    })
  }
  const optionStorageInstance = {
    loadOptions: async () => ({ ok: true, options: [], warnings: [], failure: null }),
    saveOption: async () => ({ ok: true, option: null, warnings: [], validationErrors: [], failure: null }),
    deleteOption: async () => ({ ok: true, deletedOptionId: null, affectedLaundrySetOptionIds: [], repairedLaundrySetOptionIds: [], warnings: [], failure: null })
  }

  const fakeElectron = {
    app: {
      getPath: (key) => (key === 'userData' ? '/tmp/user-data' : ''),
      isPackaged: false,
      whenReady: () => ({ then: () => {} }),
      on: () => {}
    },
    BrowserWindow: function BrowserWindow() {},
    ipcMain: {
      handle: (channel, handler) => {
        handledChannels.push({ channel, handler })
      }
    }
  }
  fakeElectron.BrowserWindow.getAllWindows = () => []

  const indexModule = loadCommonJsModule(path.join(__dirname, '..', 'src', 'main', 'index.js'), {
    electron: fakeElectron,
    './schemaStorage': {
      createSchemaStorage: () => storageInstance
    },
    './optionStorage': {
      createOptionStorage: () => optionStorageInstance
    }
  })

  indexModule.registerIpcHandlers({
    electronApp: fakeElectron.app,
    ipcMainInstance: fakeElectron.ipcMain,
    storage: storageInstance,
    optionStorage: optionStorageInstance
  })

  assert.deepEqual(
    handledChannels.map((entry) => entry.channel),
    ['schema:list', 'schema:load', 'option:load', 'option:save', 'option:delete']
  )
})
