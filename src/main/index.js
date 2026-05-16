const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const { createOptionStorage } = require('./optionStorage')
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
  storage = createSchemaStorage({
    userDataPath: electronApp.getPath('userData'),
    isPackaged: electronApp.isPackaged,
    resourcesPath: process.resourcesPath,
    runtimeDir: __dirname
  }),
  optionStorage = createOptionStorage({
    userDataPath: electronApp.getPath('userData'),
    schemaStorage: storage
  })
} = {}) {
  ipcMainInstance.handle('schema:list', () => storage.listSchemas())
  ipcMainInstance.handle('schema:load', (_event, applianceKey) => storage.loadSchema(applianceKey))
  ipcMainInstance.handle('option:load', (_event, applianceKey) => optionStorage.loadOptions(applianceKey))
  ipcMainInstance.handle('option:save', (_event, applianceKey, optionPayload) => optionStorage.saveOption(applianceKey, optionPayload))
  ipcMainInstance.handle('option:delete', (_event, applianceKey, optionId) => optionStorage.deleteOption(applianceKey, optionId))

  return {
    storage,
    optionStorage
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
