# AGENTS.md

Instructions for AI agents working on the Appliance Research Tool codebase.

## Before Any Work

1. **Read `CONTEXT.md`** — understand domain vocabulary before making any changes
2. **Read `CONTEXT.md` again** — domain terms must be used precisely
3. **Check `docs/adr/`** — read relevant ADRs before implementing architectural decisions

## Project Structure

```
src/
├── main/           # Electron main process (window management, IPC handlers)
├── preload/        # Secure context bridge (exposes safe APIs to renderer)
└── renderer/       # Vue 3 frontend
    └── src/
        ├── components/   # Vue components
        ├── composables/   # Reusable Vue logic
        ├── stores/        # Pinia stores (if used)
        └── App.vue        # Root component
```

## Naming Conventions

- Vue components: PascalCase (e.g., `OptionCard.vue`)
- JavaScript modules: camelCase (e.g., `storageAdapter.js`)
- CSS classes: kebab-case (e.g., `.option-card`)
- IPC channels: kebab-case with `:` prefix (e.g., `option:create`)
- Dimension types: lowercase (e.g., `boolean`, `enum`, `numeric`)

## Architecture Rules

### Main Process
- Window creation and lifecycle in `src/main/index.js`
- IPC handlers registered with `ipcMain.handle()`
- No Vue/React rendering — pure Node.js
- Storage access happens here (file system, future DB)

### Preload Script
- Only expose necessary APIs via `contextBridge.exposeInMainWorld('electronAPI', ...)`
- Never import Node.js modules directly into renderer

### Renderer (Vue)
- Components in `src/renderer/src/components/`
- Business logic in composables or stores
- No direct IPC — use `window.electronAPI`

## Domain Rules

- **Dimension types**: `boolean` (exact match), `enum` (multi-select), `numeric` (range)
- **N/A handling**: When filtering, N/A values trigger a visible Warning, not a failed match
- **Custom Dimensions**: Users can add Dimensions by editing JSON schema files
- **Laundry Set**: Links to sub-items (washer, dryer) via pointers, has its own Dimensions

## File Ownership

| Path | Purpose |
|------|---------|
| `src/main/index.js` | Electron main process, storage interface |
| `src/preload/index.js` | IPC bridge |
| `src/renderer/src/App.vue` | Root Vue component |
| `src/renderer/src/components/` | All Vue components |
| `schemas/` | JSON schemas per Appliance category |
| `vite.config.js` | Build configuration |
| `electron-builder.json` | Windows packaging config |

## Git Workflow

- **Merge strategy**: Rebase only, never merge commits
- Branch naming: `feature/`, `fix/`, `refactor/` prefixes
- Commits: atomic and descriptive

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
- Do NOT use "Criteria" — correct term is **Dimension**
- Do NOT say "Rating" when you mean **Evaluation**
