const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { loadCommonJsModule } = require('./helpers/loadCommonJsModule')

test('preload preserves existing electronAPI fields and adds schema and option methods', async () => {
  const exposedEntries = []
  const invokeCalls = []
  const onCalls = []

  const preloadModule = loadCommonJsModule(path.join(__dirname, '..', 'src', 'preload', 'index.js'), {
    electron: {
      contextBridge: {
        exposeInMainWorld: (key, value) => exposedEntries.push({ key, value })
      },
      ipcRenderer: {
        invoke: async (channel, ...args) => {
          invokeCalls.push([channel, ...args])
          return { channel, args }
        },
        on: (channel, handler) => {
          onCalls.push([channel, handler])
        }
      }
    }
  })

  assert.equal(exposedEntries.length, 1)
  assert.equal(exposedEntries[0].key, 'electronAPI')

  const electronApi = preloadModule.createElectronApi({
    platform: 'test-platform',
    versions: {
      node: '1',
      chrome: '2',
      electron: '3'
    },
    ipcRenderer: {
      invoke: async (channel, ...args) => {
        invokeCalls.push([channel, ...args])
        return { channel, args }
      },
      on: (channel, handler) => {
        onCalls.push([channel, handler])
      }
    }
  })

  assert.equal(electronApi.platform, 'test-platform')
  assert.deepEqual(electronApi.versions, {
    node: '1',
    chrome: '2',
    electron: '3'
  })
  assert.equal(typeof electronApi.onUpdateCounter, 'function')
  assert.equal(typeof electronApi.listSchemas, 'function')
  assert.equal(typeof electronApi.loadSchema, 'function')
  assert.equal(typeof electronApi.loadOptions, 'function')
  assert.equal(typeof electronApi.saveOption, 'function')
  assert.equal(typeof electronApi.deleteOption, 'function')

  const callback = () => {}
  electronApi.onUpdateCounter(callback)
  await electronApi.listSchemas()
  await electronApi.loadSchema('washer')
  await electronApi.loadOptions('washer')
  await electronApi.saveOption('washer', { evaluations: {} })
  await electronApi.deleteOption('washer', 'option-1')

  assert.equal(onCalls[0][0], 'update-counter')
  assert.deepEqual(invokeCalls, [
    ['schema:list'],
    ['schema:load', 'washer'],
    ['option:load', 'washer'],
    ['option:save', 'washer', { evaluations: {} }],
    ['option:delete', 'washer', 'option-1']
  ])
})
