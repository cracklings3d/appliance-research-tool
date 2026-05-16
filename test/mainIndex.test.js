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
    }
  })

  indexModule.registerIpcHandlers({
    electronApp: fakeElectron.app,
    ipcMainInstance: fakeElectron.ipcMain,
    storage: storageInstance
  })

  assert.deepEqual(
    handledChannels.map((entry) => entry.channel),
    ['schema:list', 'schema:load']
  )
})
