const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { loadCommonJsModule } = require('./helpers/loadCommonJsModule')

const repoRoot = path.join(__dirname, '..')
const distMainDir = path.join(repoRoot, 'dist', 'main')

function buildProject() {
  assert.ok(process.env.npm_execpath, 'npm_execpath should be available when tests run via npm')

  execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'pipe'
  })
}

function createFakeElectronRuntime() {
  const createdWindows = []

  function FakeBrowserWindow(options) {
    this.options = options
    this.webContents = {
      openDevTools: () => {}
    }
    this.loadURL = () => {}
    this.loadFile = () => {}

    createdWindows.push(this)
  }

  FakeBrowserWindow.getAllWindows = () => createdWindows

  return {
    createdWindows,
    electron: {
      app: {
        getPath: (key) => (key === 'userData' ? '/tmp/user-data' : ''),
        isPackaged: false,
        whenReady: () => ({
          then: (callback) => {
            callback()
            return { catch: () => {} }
          }
        }),
        on: () => {},
        quit: () => {}
      },
      BrowserWindow: FakeBrowserWindow,
      ipcMain: {
        handle: () => {}
      }
    }
  }
}

test('main process registers schema IPC handlers explicitly', () => {
  const handledChannels = []
  const schemaStorageCalls = []
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
  const presetStorageInstance = {
    loadPresets: async () => ({ ok: true, presets: [], warnings: [], failure: null }),
    savePreset: async () => ({ ok: true, preset: null, warnings: [], validationErrors: [], failure: null }),
    deletePreset: async () => ({ ok: true, deletedPresetId: null, warnings: [], failure: null })
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
      createSchemaStorage: () => {
        schemaStorageCalls.push('create')
        return storageInstance
      }
    },
    './optionStorage': {
      createOptionStorage: () => optionStorageInstance
    },
    './presetStorage': {
      createPresetStorage: ({ schemaStorage }) => {
        schemaStorageCalls.push(schemaStorage)
        return presetStorageInstance
      }
    }
  })

  indexModule.registerIpcHandlers({
    electronApp: fakeElectron.app,
    ipcMainInstance: fakeElectron.ipcMain,
    storage: storageInstance,
    optionStorage: optionStorageInstance,
    presetStorage: presetStorageInstance
  })

  assert.deepEqual(
    handledChannels.map((entry) => entry.channel),
    ['schema:list', 'schema:load', 'option:load', 'option:save', 'option:delete', 'preset:load', 'preset:save', 'preset:delete']
  )
  assert.deepEqual(schemaStorageCalls, [])
})

test('main process creates one shared schema storage instance for option and preset storage by default', () => {
  const handledChannels = []
  const capturedSchemaStorage = []
  const sharedStorageInstance = {
    listSchemas: async () => ({ schemas: [], warnings: [] }),
    loadSchema: async () => ({ ok: true, schema: { appliance: 'washer' }, warnings: [], failure: null })
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
      handle: (channel) => {
        handledChannels.push(channel)
      }
    }
  }
  fakeElectron.BrowserWindow.getAllWindows = () => []

  const indexModule = loadCommonJsModule(path.join(__dirname, '..', 'src', 'main', 'index.js'), {
    electron: fakeElectron,
    './schemaStorage': {
      createSchemaStorage: () => sharedStorageInstance
    },
    './optionStorage': {
      createOptionStorage: ({ schemaStorage }) => {
        capturedSchemaStorage.push(schemaStorage)
        return {
          loadOptions: async () => ({ ok: true, options: [], warnings: [], failure: null }),
          saveOption: async () => ({ ok: true, option: null, warnings: [], validationErrors: [], failure: null }),
          deleteOption: async () => ({ ok: true, deletedOptionId: null, affectedLaundrySetOptionIds: [], repairedLaundrySetOptionIds: [], warnings: [], failure: null })
        }
      }
    },
    './presetStorage': {
      createPresetStorage: ({ schemaStorage }) => {
        capturedSchemaStorage.push(schemaStorage)
        return {
          loadPresets: async () => ({ ok: true, presets: [], warnings: [], failure: null }),
          savePreset: async () => ({ ok: true, preset: null, warnings: [], validationErrors: [], failure: null }),
          deletePreset: async () => ({ ok: true, deletedPresetId: null, warnings: [], failure: null })
        }
      }
    }
  })

  const result = indexModule.registerIpcHandlers({
    electronApp: fakeElectron.app,
    ipcMainInstance: fakeElectron.ipcMain
  })

  assert.equal(capturedSchemaStorage.length, 2)
  assert.equal(capturedSchemaStorage[0], sharedStorageInstance)
  assert.equal(capturedSchemaStorage[1], sharedStorageInstance)
  assert.equal(result.storage, sharedStorageInstance)
  assert.deepEqual(handledChannels, [
    'schema:list',
    'schema:load',
    'option:load',
    'option:save',
    'option:delete',
    'preset:load',
    'preset:save',
    'preset:delete'
  ])
})

test('built main output starts successfully and covers both storage sibling modules', () => {
  buildProject()

  const builtEntryPath = path.join(distMainDir, 'index.js')
  const builtEntryContents = fs.readFileSync(builtEntryPath, 'utf8')
  const siblingModuleNames = ['optionStorage', 'presetStorage']

  for (const siblingModuleName of siblingModuleNames) {
    const emittedRequire = `./${siblingModuleName}`

    if (!builtEntryContents.includes(emittedRequire)) {
      continue
    }

    const emittedSiblingPath = path.join(distMainDir, `${siblingModuleName}.js`)
    assert.equal(fs.existsSync(emittedSiblingPath), true, `${siblingModuleName} should be emitted beside dist/main/index.js`)

    const siblingModule = loadCommonJsModule(emittedSiblingPath)
    assert.equal(typeof siblingModule[`create${siblingModuleName[0].toUpperCase()}${siblingModuleName.slice(1)}`], 'function')
  }

  const fakeRuntime = createFakeElectronRuntime()

  assert.doesNotThrow(() => {
    loadCommonJsModule(builtEntryPath, {
      electron: fakeRuntime.electron
    })
  }, 'built dist/main/index.js should load without storage module resolution failures')

  assert.equal(fakeRuntime.createdWindows.length, 1)
})
