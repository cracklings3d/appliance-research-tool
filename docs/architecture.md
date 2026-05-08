# Architecture Overview

## Process Model

Electron runs the app in **two separate processes**:

### 1. Main Process (`src/main/index.js`)

The main process is the entry point of the application. It runs in Node.js and has full access to:

- System resources (file system, native dialogs, menus)
- App lifecycle management (create windows, quit app)
- IPC communication with renderer

**Responsibilities:**
- Create and manage BrowserWindow instances
- Handle app-level events (ready, activate, quit)
- Define IPC handlers for main-to-renderer communication
- Manage menus, tray icons, and system-level features

### 2. Preload Script (`src/preload/index.js`)

The preload script runs in a special environment that has access to both Node.js and the renderer. It acts as a **secure bridge** between main and renderer processes.

**Key Concept: Context Isolation**

Electron uses context isolation to prevent renderer pages from directly accessing Node.js APIs (security). The preload script uses `contextBridge` to expose only specific, safe APIs to the renderer via `window.electronAPI`.

### 3. Renderer Process (`src/renderer/`)

The renderer process runs the Vue 3 frontend in a Chromium browser. It has no direct access to Node.js APIs (when context isolation is enabled).

**Communication Flow:**

```
Renderer (Vue)  <--contextBridge-->  Preload  <--ipcRenderer/ipcMain-->  Main (Node.js)
```

## Why This Architecture?

1. **Security** - Context isolation prevents malicious web content from accessing system resources
2. **Stability** - Renderer crashes don't bring down the main process
3. **Performance** - Separate processes can be optimized independently

## Adding Features

### Adding a New IPC Channel

1. **Main process** - Define the handler:

```javascript
// src/main/index.js
const { ipcMain } = require('electron')

ipcMain.handle('my-channel', async (event, ...args) => {
  // Handle the request
  return result
})
```

2. **Preload script** - Expose via contextBridge:

```javascript
// src/preload/index.js
contextBridge.exposeInMainWorld('electronAPI', {
  myMethod: (...args) => ipcRenderer.invoke('my-channel', ...args)
})
```

3. **Renderer** - Use in Vue component:

```javascript
const result = await window.electronAPI.myMethod(arg1, arg2)
```

### Adding Vue Components

1. Create `.vue` files in `src/renderer/src/components/`
2. Import and use in `App.vue` or other components

## Build Output

- `dist/main/` - Compiled main process code
- `dist/preload/` - Compiled preload scripts
- `dist/renderer/` - Built Vue app (HTML, JS, CSS, assets)
- `release/` - Packaged executables (after `electron:build`)
