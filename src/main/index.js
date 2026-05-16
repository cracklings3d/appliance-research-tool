const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const { createOptionStorage } = require('./optionStorage')
const { createPresetStorage } = require('./presetStorage')
const { createSchemaStorage } = require('./schemaStorage')

process.env.DIST_ELECTRON = path.join(__dirname, '../..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, 'dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, 'public')
  : path.join(process.env.DIST, 'renderer')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png')
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(process.env.DIST, 'renderer/index.html'))
  }
}

function registerIpcHandlers({
  electronApp = app,
  ipcMainInstance = ipcMain,
  storage,
  optionStorage,
  presetStorage
} = {}) {
  const sharedStorage = storage ?? createSchemaStorage({
    userDataPath: electronApp.getPath('userData'),
    isPackaged: electronApp.isPackaged,
    resourcesPath: process.resourcesPath,
    runtimeDir: __dirname
  })

  const sharedOptionStorage = optionStorage ?? createOptionStorage({
    userDataPath: electronApp.getPath('userData'),
    schemaStorage: sharedStorage
  })

  const sharedPresetStorage = presetStorage ?? createPresetStorage({
    userDataPath: electronApp.getPath('userData'),
    schemaStorage: sharedStorage
  })

  ipcMainInstance.handle('schema:list', () => sharedStorage.listSchemas())
  ipcMainInstance.handle('schema:load', (_event, applianceKey) => sharedStorage.loadSchema(applianceKey))
  ipcMainInstance.handle('option:load', (_event, applianceKey) => sharedOptionStorage.loadOptions(applianceKey))
  ipcMainInstance.handle('option:save', (_event, applianceKey, optionPayload) => sharedOptionStorage.saveOption(applianceKey, optionPayload))
  ipcMainInstance.handle('option:delete', (_event, applianceKey, optionId) => sharedOptionStorage.deleteOption(applianceKey, optionId))
  ipcMainInstance.handle('preset:load', (_event, applianceKey) => sharedPresetStorage.loadPresets(applianceKey))
  ipcMainInstance.handle('preset:save', (_event, applianceKey, presetPayload) => sharedPresetStorage.savePreset(applianceKey, presetPayload))
  ipcMainInstance.handle('preset:delete', (_event, applianceKey, presetId) => sharedPresetStorage.deletePreset(applianceKey, presetId))

  return {
    storage: sharedStorage,
    optionStorage: sharedOptionStorage,
    presetStorage: sharedPresetStorage
  }
}

function startApplication() {
  app.whenReady().then(() => {
    registerIpcHandlers()
    createWindow()
  })
}

startApplication()

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

module.exports = {
  createWindow,
  registerIpcHandlers,
  startApplication
}
