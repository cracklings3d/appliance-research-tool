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
- Shipped schema per Appliance starts in `schemas/` and is copied into user data on first run, where user edits become the local source of truth
- Users can add custom Dimensions by editing schema JSON outside the app; in-app schema editing is out of scope for MVP
- **Options** are stored in one JSON file per **Appliance** for MVP, with larger-scale storage changes deferred until needed
- Every **Option** has a stable app-level identifier independent of any schema-defined **Dimension** such as `model`
- The app may show a read-only shortened form of an **Option** identifier for human identification, but the full identifier remains internal
- An **Evaluation** is stored as an object with an explicit value/status structure rather than as a bare primitive
- MVP **Evaluation** statuses are limited to `known` and `na`; the model does not distinguish between missing and N/A
- MVP schema **Dimension** types are limited to `boolean`, `enum`, `numeric`, `string`, and `pointer`
- MVP `numeric` **Dimension** filtering is limited to min/max range inputs
- A pointer **Evaluation** stores only the target **Option** identifier in MVP; denormalized labels or snapshots are deferred unless performance demands them later
- MVP pointer **Dimensions** are only valid on the **Laundry Set** schema
- When schema changes make stored **Options** outdated, the app auto-migrates what it can and warns clearly about anything that still needs attention
- MVP auto-migration is limited to safe structural changes such as adding optional **Dimensions**, dropping obsolete stored fields, and preserving matching fields by key
- Each **Appliance** schema defines the default list ordering used when the user has not chosen an explicit comparison order
- **String Dimensions** support strict equality and case-insensitive substring matching for filtering
- In the default filtering mode, **Dimensions** combine with logical AND, while multi-select values inside a single enum **Dimension** combine with logical OR
- User-configurable cross-Dimension logical composition is reserved for a future expert mode and is out of scope for MVP
- **Brand** and **Model** are schema-defined **Dimensions** whose required-ness is determined by each **Appliance** schema rather than by a global built-in rule
- **Options** with relevant N/A **Evaluations** that otherwise pass active filters are grouped below complete matches and still ordered internally by the active comparison rules where possible
- N/A **Evaluations** are visually differentiated in list views so users can distinguish unknown values from matching values
- MVP **Comparison** is a side-by-side view of user-selected **Options** and user-selected **Dimensions**, with no computed overall winner or scoring model
- MVP **Comparison** is scoped to one selected **Appliance** at a time and does not mix **Options** from different **Appliances**
- Each **Appliance** has a built-in default set of **Dimensions** for comparison
- Users can adjust the compared **Dimensions** for the current view and save named comparison presets in MVP
- Comparison presets are user-owned local preferences stored per app profile, not in appliance schema files
- If a saved comparison preset references a missing **Dimension**, the app shows a clear warning and silently ignores that **Dimension** until the preset is repaired
- MVP comparison does not impose a hard cap on how many **Options** a user may place side-by-side
- Each **Appliance** schema may define separate default rules for list ordering and comparison presentation
- CRUD editing uses explicit save/cancel forms rather than immediate persistence on every field change
- Invalid **Option** edits block save and surface field-level validation errors in the edit form
- Deleting an **Option** requires a confirmation dialog that explains downstream impacts such as affected **Laundry Set Options**

## Relationships

- A **Washer** and a **Dryer** are each first-class **Appliances** with their own **Option** records and comparison workflows
- A **Laundry Set** is its own **Appliance** with its own **Option** records
- A **Laundry Set Option** contains bundle-level **Evaluations** and delegates sub-item **Evaluations** through `washer` and `dryer` pointers
- Delegated **Dimensions** are addressed through namespaced paths such as `washer.capacity` and `dryer.noiseLevel`
- Delegated **Dimensions** are read-only in **Laundry Set** workflows and must be edited on the underlying **Washer** or **Dryer Option**
- Deleting a referenced **Washer Option** or **Dryer Option** nulls the corresponding pointer on affected **Laundry Set Options** and leaves those sets incomplete until repaired
- Incomplete **Laundry Set Options** remain visible, are shown greyed out with a warning indicator, and explain the missing delegated reference on hover
- If an incomplete **Laundry Set Option** is already in a comparison view, the entire compared entry is shown greyed out
- Newly created or edited **Laundry Set Options** must reference both a **Washer Option** and a **Dryer Option** to be saved

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
