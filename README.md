# Appliance Research Tool

A desktop application for planning and comparing options when buying appliances.

## Domain Language

See [GLOSSARY.md](./GLOSSARY.md) for the authoritative vocabulary on Appliances, Options, Dimensions, Evaluations, and more.

## Tech Stack

- **Electron** - Cross-platform desktop runtime
- **Vue 3** - Frontend framework with Composition API
- **Vite** - Fast build tool and dev server
- **electron-builder** - Packaging for Windows executables

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development Mode

Run the app in development mode with hot reload:

```bash
npm run electron:dev
```

### Build for Production

Build the renderer (Vue app):

```bash
npm run build
```

Package as Windows executable:

```bash
npm run electron:build
```

The executable will be created in `release/` folder.

## Project Structure

```
appliance-research-tool/
├── src/
│   ├── main/           # Electron main process
│   │   └── index.js
│   ├── preload/        # Secure IPC bridge
│   │   └── index.js
│   └── renderer/       # Vue 3 frontend
│       ├── index.html
│       └── src/
│           ├── main.js
│           ├── App.vue
│           ├── assets/
│           └── components/
├── build/              # App icons and assets
├── dist/               # Build output
├── release/            # Packaged executables
├── package.json
├── vite.config.js
└── electron-builder.json
```

## Architecture

The app follows Electron's **main/preload/renderer** process model:

- **Main Process** (`src/main/`) - Handles window creation, system access, and app lifecycle
- **Preload Script** (`src/preload/`) - Exposes safe APIs to renderer via contextBridge
- **Renderer Process** (`src/renderer/`) - Vue 3 app running in Chromium

Communication between main and renderer is done via IPC (Inter-Process Communication) through the preload bridge.

## MVP Data Contracts

MVP schema and option contracts for `washer`, `dryer`, and `laundry-set` are defined in [`schemas/`](./schemas/README.md).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server only |
| `npm run electron:dev` | Run app in development mode |
| `npm run build` | Build Vue app for production |
| `npm run electron:build` | Package app as Windows executable |
