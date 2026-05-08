# AGENTS.md

Instructions for AI agents working on the Appliance Research Tool codebase.

## Quick Start

1. Read `CONTEXT.md` for domain terminology before making any changes
2. Read `docs/architecture.md` for the main/preload/renderer architecture
3. Check `docs/adr/` for architectural decisions before implementing

## Project Structure

```
src/
├── main/           # Electron main process (window management, IPC handlers)
├── preload/        # Secure context bridge (exposes safe APIs to renderer)
└── renderer/       # Vue 3 frontend
    └── src/
        ├── components/   # Vue components
        ├── assets/       # Styles, images
        └── App.vue       # Root component
```

## Naming Conventions

- Vue components: PascalCase (e.g., `ResearchSessionCard.vue`)
- JavaScript modules: camelCase (e.g., `comparisonEngine.js`)
- CSS classes: kebab-case (e.g., `.appliance-card`)
- IPC channels: kebab-case with `:` prefix (e.g., `session:create`)

## Architecture Rules

### Main Process
- Window creation and lifecycle in `src/main/index.js`
- IPC handlers registered with `ipcMain.handle()`
- No Vue/React rendering — pure Node.js

### Preload Script
- Only expose necessary APIs via `contextBridge.exposeInMainWorld()`
- Never import Node.js modules directly into renderer

### Renderer (Vue)
- Components in `src/renderer/src/components/`
- Business logic in composables (`src/renderer/src/composables/`) or stores
- No direct IPC — use `window.electronAPI`

## When Implementing Features

1. **Define the seam first** — what is the interface, what sits behind it?
2. **Follow the deletion test** — if you deleted this module, does complexity vanish or spread?
3. **Add terms to CONTEXT.md** — if a new domain concept emerges, document it
4. **Create ADRs for significant decisions** — hard-to-reverse, surprising, or trade-off decisions

## File Ownership

| Path | Purpose |
|------|---------|
| `src/main/index.js` | Electron main process |
| `src/preload/index.js` | IPC bridge |
| `src/renderer/src/App.vue` | Root Vue component |
| `src/renderer/src/components/` | All Vue components |
| `vite.config.js` | Build configuration |
| `electron-builder.json` | Windows packaging config |

## Allowed Commands

| Command | When to Use |
|---------|-------------|
| `npm run electron:dev` | Development with hot reload |
| `npm run build` | Build Vue app |
| `npm run electron:build` | Package Windows executable |

## Constraints

- Do NOT modify `node_modules/` directly
- Do NOT commit secrets, API keys, or credentials
- Do NOT bypass the preload bridge for Node.js access in renderer
- Do NOT introduce circular dependencies between modules

## Context Boundaries

Keep each agent task focused. If working on:
- **UI changes**: Only touch `src/renderer/src/components/` and related assets
- **IPC handlers**: Only touch `src/main/index.js` and `src/preload/index.js`
- **Architecture**: Read `docs/architecture.md` and relevant ADRs first
