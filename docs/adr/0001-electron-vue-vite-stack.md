# Electron + Vue 3 + Vite Stack

We will build the Appliance Research Tool as an Electron desktop application with Vue 3 for the renderer and Vite as the build tool.

**Context**: We needed a cross-platform desktop app with zero runtime cost on Windows. The team is familiar with web technologies (Vue.js). Alternatives considered were Tauri (Rust-based, smaller bundles, steeper learning curve) and Neutralinojs (lighter but smaller ecosystem).

**Decision**: Electron was chosen for its maturity, extensive ecosystem, and the team's web development familiarity. Vue 3 + Vite provides a familiar component-based frontend with fast HMR during development. Vite-plugin-electron bridges the build process cleanly.

**Status**: accepted

**Considered Options**:
- **Tauri**: Smaller binaries (~10MB vs ~150MB), but requires Rust knowledge and has a smaller ecosystem
- **Neutralinojs**: Ultra-lightweight, but limited plugins and community
- **Electron** (chosen): Battle-tested, huge ecosystem, familiar to web devs, larger bundle size acceptable for this use case
- **Native (Win32 API)**: Steepest learning curve, no cross-platform without significant rework
