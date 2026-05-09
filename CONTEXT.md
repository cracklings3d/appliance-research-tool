# Appliance Research Tool

A desktop application for planning and comparing options when buying appliances.

## Overview

Users select an Appliance category, browse/compare Options within it, filter by Dimensions, and rank results. Data is stored locally as JSON files with user-editable schemas.

## Domain Language

See [GLOSSARY.md](./GLOSSARY.md) for the authoritative vocabulary.

Key terms:
- **Appliance** — category type (e.g., Laundry Set)
- **Option** — specific product model within a category
- **Dimension** — field used for filtering/ranking (price, capacity, etc.)
- **Evaluation** — value of an Option on a Dimension (may be N/A)

## Tech Stack

- **Electron** — desktop runtime
- **Vue 3** — frontend framework
- **Vite** — build tool

## Data Storage

- Local JSON files (v1)
- Schema per Appliance in `schemas/` directory
- Users can add custom Dimensions by editing schema JSON

## Architecture

```
src/
├── main/           # Electron main process
├── preload/        # IPC bridge
└── renderer/       # Vue 3 frontend
```

See [docs/adr/](docs/adr/) for architectural decisions.

## Quick Start

```bash
npm install
npm run electron:dev
```
