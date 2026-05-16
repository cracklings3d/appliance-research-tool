# Canonical Plan — Issue #10: Implement schema bootstrap/load storage and IPC contract

- Issue: [#10](https://github.com/cracklings3d/appliance-research-tool/issues/10)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #10

## 1. Clarified objective

Implement the persistence-only schema bootstrap/load slice in the Electron main/preload boundary so the renderer can discover available **Appliance** schemas and load a specific schema from the active app profile without direct file system access.

This slice must:

- bootstrap shipped schema files into the active app profile only when the canonical local schema file for that **Appliance** is missing
- treat the local copied schema files as the editable source of truth after bootstrap, including degraded cases where shipped schema assets later become unavailable
- preserve the existing non-schema preload API surface (`platform`, `versions`, `onUpdateCounter`) and add exactly two new schema methods: `listSchemas()` and `loadSchema(applianceKey)`
- return structured warnings/failures as data, not as a separate event stream

## 2. Scope boundaries

### In scope

- shipped schema bootstrap for MVP **Appliances** only
- local discovery and load for the canonical MVP **Appliance** schema files in the active app profile
- structured return envelopes for `listSchemas()` and `loadSchema(applianceKey)`
- Electron main process handlers and preload bridge exposure
- narrow validation needed to distinguish valid schema loads from invalid/unreadable/contract-invalid schema files
- focused tests for bootstrap, load, warning/failure behavior, and packaged-resource path assumptions

### Out of scope

- schema editing UI or renderer schema editing workflow
- `saveSchema()`, `deleteSchema()`, or any write API beyond bootstrap copy-if-missing
- **Option** persistence, migration, delete-repair, or preset persistence
- renderer warning presentation details
- schema mutation/rewrite during bootstrap
- broad storage architecture refactors unrelated to schema bootstrap/load

## 3. Repository facts that constrain the plan

- Domain vocabulary is defined in `CONTEXT.md` and `GLOSSARY.md`; use **Appliance**, **Option**, **Dimension**, and **Evaluation** precisely.
- Issue #1 already defines the schema contract in `schemas/README.md` and the shipped files:
  - `schemas/washer.schema.json`
  - `schemas/dryer.schema.json`
  - `schemas/laundry-set.schema.json`
- Current Electron structure is minimal:
  - `src/main/index.js` creates the window but has no storage helpers or IPC handlers yet.
  - `src/preload/index.js` currently exposes `platform`, `versions`, and `onUpdateCounter`; issue #10 must preserve these existing APIs and extend the same `electronAPI` object with schema-read methods.
- `schemas/fixtures/` and `schemas/README.md` exist beside the shipped schema files and must not be treated as schema documents.
- `electron-builder.json` currently packages only `dist/**/*`; this issue must add explicit packaged-schema asset support or packaged builds will fail schema bootstrap/load.
- No test harness is currently present in the repo.

## 4. Required implementation shape

## 4.1 Main-process responsibilities

Add a narrowly scoped schema storage module in `src/main/` and keep `src/main/index.js` focused on lifecycle/window wiring plus IPC registration.

Recommended file split:

- `src/main/index.js`
  - register `ipcMain.handle()` handlers
  - construct/invoke schema storage helpers
- `src/main/schemaStorage.js` (new)
  - resolve shipped schema location
  - resolve active app-profile schema location
  - bootstrap missing local schema files
  - list schema summaries with warnings
  - load one schema with structured success/failure envelope
  - centralize warning/failure code constants used by this slice

Do not bury schema file system logic directly inside the window bootstrap code.

## 4.2 Active app-profile storage location

Use the active Electron profile directory returned by `app.getPath('userData')` and store local schemas under a dedicated `schemas/` child directory.

Planned local directory:

```text
<userData>/schemas/
```

This keeps schema storage profile-local and aligns with the issue requirement that copied local schema files become the editable source of truth.

## 4.3 Shipped schema source resolution

Implementation must support both development and packaged runtime.

Planned resolution rules:

1. In development, resolve shipped schemas from the repo-root directory `schemas/`.
2. In packaged runtime, resolve shipped schemas from `path.join(process.resourcesPath, 'schemas')`.
3. `electron-builder.json` must add a mandatory `extraResources` entry that copies only `schemas/*.schema.json` into the packaged `schemas/` resource directory.
4. Runtime discovery must treat only root-level `*.schema.json` files in that resolved directory as shipped schema documents; `schemas/fixtures/` and `schemas/README.md` are never schema documents for this issue.
5. Development-time resolution must be verified from the built main-process runtime context, not only from source-relative assumptions, so repo-root `schemas/` still resolves correctly when `src/main/index.js` is emitted under `dist/`.

This packaged-asset change is required for issue completion; it is not optional.

## 4.4 Bootstrap behavior

Bootstrap is not a separate public API. It should run inside the main-process schema read flow only as a per-key copy-if-missing fallback when a canonical local schema file is absent.

Bootstrap rules:

- create the local schema directory if it does not exist
- treat `washer`, `dryer`, and `laundry-set` as the only canonical MVP **Appliance** keys for this issue
- for each canonical key, check the canonical local file first
- if the local file already exists for a key, read that local file directly and do **not** require shipped schema access for that key
- only if the local file is missing for a key, resolve the corresponding shipped schema file and copy it into the local schema directory
- never overwrite an existing local schema file
- never delete unrelated/non-schema files from the local schema directory
- never copy `fixtures/` files or `README.md`

Operational consequence:

- `listSchemas()` and `loadSchema(applianceKey)` may both invoke bootstrap logic internally, but only for canonical keys whose local file is missing at the time of the call
- missing shipped assets must not block or warn for keys that already have a usable local schema file

This preserves the issue requirement that bootstrap is copy-if-missing only and that local schema files remain authoritative after first run.

## 4.5 Renderer-facing preload contract

`src/preload/index.js` must preserve the existing non-schema `electronAPI` fields and add the schema-read contract to that same object. This issue does **not** remove or rename `platform`, `versions`, or `onUpdateCounter`.

Required preload object shape after this issue:

```json
{
  "platform": "<existing value>",
  "versions": {
    "node": "<existing value>",
    "chrome": "<existing value>",
    "electron": "<existing value>"
  },
  "onUpdateCounter": "<existing callback registration>",
  "listSchemas": "<new function>",
  "loadSchema": "<new function>"
}
```

Expose exactly these new preload methods for this slice:

- `listSchemas()`
- `loadSchema(applianceKey)`

Do not expose direct file paths, raw `ipcRenderer`, or any additional schema mutation method in this slice.

Recommended IPC channel names, following repo conventions:

- `schema:list`
- `schema:load`

The plan intentionally preserves unrelated existing preload APIs; replacing the exposed API surface entirely is out of scope and should be treated as a regression.

## 4.6 Stable return envelopes

The implementation must keep the envelope shapes stable and machine-readable.

### Canonical warning/failure object shape

For this issue, warning and failure payloads must use the same canonical field set so downstream renderer code does not need per-flow shape branching.

Required object shape:

```json
{
  "code": "SCHEMA_CONTRACT_INVALID",
  "message": "Schema could not be used.",
  "applianceKey": "washer"
}
```

Field rules:

- `code`: required string from the fixed code set in section 4.7
- `message`: required human-readable string suitable for logs/debug UI
- `applianceKey`: required canonical appliance key string when the warning/failure is tied to one schema file; for issue #10, bootstrap/source warnings should be attached to the specific canonical key that still needs bootstrap rather than emitted as a global warning for all keys
- exception for `UNKNOWN_APPLIANCE_KEY`: `loadSchema(applianceKey)` must echo the exact caller-supplied string argument in `failure.applianceKey` so the required field remains populated and diagnostics stay specific

Do not introduce flow-specific required fields for this issue. Additional ad hoc fields are out of scope because they increase contract drift risk.

### `listSchemas()` envelope

Required top-level fields:

```json
{
  "schemas": [],
  "warnings": []
}
```

Requirements:

- `schemas` contains only successfully loaded schema summaries
- `listSchemas()` enumerates only the canonical local schema files for `washer`, `dryer`, and `laundry-set` after bootstrap; it does not scan arbitrary extra local `*.schema.json` files
- `listSchemas()` must process canonical keys in this fixed order: `washer`, `dryer`, `laundry-set`
- `listSchemas()` must evaluate each canonical key independently: read local first, and only attempt shipped-schema bootstrap when that key's local file is missing
- each summary must include `applianceKey`
- summaries must not include the full schema document
- parseable but contract-invalid schema files are omitted from `schemas`, produce a warning, and never produce a partial summary
- if one schema file is missing, invalid, unreadable, or unbootstrappable, other valid schema summaries must still be returned
- per-file problems must appear in `warnings`, not as unexpected IPC rejection
- if shipped schema assets are unavailable but one or more canonical local schema files already exist, those existing locals must still be listed successfully without a global shipped-source warning for those already-present keys
- every warning entry uses the canonical warning object shape defined above
- `schemas` ordering must follow the same fixed canonical key order, filtered to only the keys that produced valid summaries
- `warnings` ordering must also follow that fixed canonical key order; if a key hits a blocking problem, emit only the first terminal warning for that key so the array remains deterministic

Planned summary shape:

```json
{
  "applianceKey": "washer",
  "displayName": "Washer",
  "schemaVersion": "1.0"
}
```

`displayName` and `schemaVersion` are included because they are already present in the shipped schema contract and help the renderer discover available **Appliances** without loading every full schema document.

### `loadSchema(applianceKey)` envelope

Required top-level fields:

```json
{
  "ok": true,
  "schema": {},
  "warnings": [],
  "failure": null
}
```

Requirements:

- success result: `ok: true`, `schema` is the full schema document, `failure: null`
- failure result: `ok: false`, `schema: null`, `failure` is a structured object
- `warnings` is reserved for non-fatal conditions that accompany a successful load; for issue #10 there are no defined non-fatal load conditions, so `loadSchema(applianceKey)` must return `warnings: []` on both success and failure unless this plan is explicitly revised later
- `loadSchema(applianceKey)` resolves only the canonical local file `<userData>/schemas/<applianceKey>.schema.json` for the requested MVP **Appliance** key
- `loadSchema(applianceKey)` must check the canonical local file first and attempt shipped-schema bootstrap only when that local file is missing
- missing requested schema, invalid JSON, unreadable file, or bootstrap failure must be returned as structured business results rather than unexpected IPC rejection
- parseable but contract-invalid requested schema files must fail the call; they are never returned as partial schema data
- if local schema is missing but bootstrap succeeds, return the bootstrapped local schema as success
- if the local schema already exists, later shipped-source unavailability must not prevent a successful load of that local schema
- any condition serious enough to prevent returning a valid full schema is represented in `failure`, not in `warnings`

Planned failure shape:

```json
{
  "code": "SCHEMA_NOT_FOUND",
  "message": "Requested schema could not be loaded.",
  "applianceKey": "washer"
}
```

The failure object uses the same canonical field shape defined above.

## 4.7 Warning/failure code strategy

Every warning and failure object in this slice must use the canonical `{ code, message, applianceKey }` shape.

Centralize codes in the schema storage module so the preload/API contract stays stable.

Use this fixed canonical code set rather than ad hoc strings:

- `UNKNOWN_APPLIANCE_KEY`
- `SHIPPED_SCHEMA_SOURCE_MISSING`
- `SCHEMA_BOOTSTRAP_COPY_FAILED`
- `LOCAL_SCHEMA_NOT_FOUND`
- `SCHEMA_FILE_UNREADABLE`
- `SCHEMA_JSON_PARSE_FAILED`
- `SCHEMA_CONTRACT_INVALID`
- `SCHEMA_APPLIANCE_KEY_MISMATCH`

Code usage rules:

- `listSchemas()` uses these codes in `warnings` and continues returning other valid summaries where possible.
- `loadSchema()` uses these same codes in `failure.code` for the requested schema outcome.
- `UNKNOWN_APPLIANCE_KEY` is used only by `loadSchema(applianceKey)` when the provided key is outside the canonical MVP set, and `failure.applianceKey` must equal the exact caller-supplied string argument.
- `SCHEMA_CONTRACT_INVALID` is the canonical result when a schema parses but fails the minimum required-field checklist below.
- `SCHEMA_APPLIANCE_KEY_MISMATCH` is reserved for cases where a parsed schema document's `appliance` value does not match the canonical file/key being resolved.
- `SHIPPED_SCHEMA_SOURCE_MISSING` and `SCHEMA_BOOTSTRAP_COPY_FAILED` are valid only when the local schema for the affected canonical key is missing and bootstrap is actually required for that key.
- if a canonical local schema file already exists, the implementation must not emit `SHIPPED_SCHEMA_SOURCE_MISSING` or `SCHEMA_BOOTSTRAP_COPY_FAILED` for that key.
- in `listSchemas()`, shipped-source/bootstrap problems should be emitted per affected missing-local key rather than as a single global warning that obscures which keys remain available locally.
- `loadSchema().warnings` remains `[]` for all outcomes in this issue scope; callers should not expect warning-bearing partial success semantics from `loadSchema()` yet.

## 4.8 Validation boundary

Validation for this slice should be narrow and contract-driven, not a speculative full schema engine.

Validate enough to prevent invalid schema files from being treated as successful loads.

### Minimum schema-validation checklist for this issue

Successful summary/load requires all of the following minimum rules to pass:

| Field / condition | Minimum rule | `listSchemas()` outcome when invalid | `loadSchema()` outcome when invalid |
| --- | --- | --- | --- |
| JSON syntax | File parses as syntactically valid JSON | Omit schema summary; add warning with `SCHEMA_JSON_PARSE_FAILED` | Return `ok: false` with `failure.code = SCHEMA_JSON_PARSE_FAILED` |
| Document root | Parsed JSON root is an object (not array, string, number, boolean, or null) | Omit schema summary; add warning with `SCHEMA_CONTRACT_INVALID` | Return `ok: false` with `failure.code = SCHEMA_CONTRACT_INVALID` |
| File readability | File can be read from disk | Omit schema summary; add warning with `SCHEMA_FILE_UNREADABLE` | Return `ok: false` with `failure.code = SCHEMA_FILE_UNREADABLE` |
| `appliance` | Required non-empty string and one of `washer`, `dryer`, `laundry-set` | Omit schema summary; add warning with `SCHEMA_CONTRACT_INVALID` | Return `ok: false` with `failure.code = SCHEMA_CONTRACT_INVALID` |
| `displayName` | Required non-empty string | Omit schema summary; add warning with `SCHEMA_CONTRACT_INVALID` | Return `ok: false` with `failure.code = SCHEMA_CONTRACT_INVALID` |
| `schemaVersion` | Required non-empty string | Omit schema summary; add warning with `SCHEMA_CONTRACT_INVALID` | Return `ok: false` with `failure.code = SCHEMA_CONTRACT_INVALID` |
| `dimensions` | Required array | Omit schema summary; add warning with `SCHEMA_CONTRACT_INVALID` | Return `ok: false` with `failure.code = SCHEMA_CONTRACT_INVALID` |
| Requested key match | For `loadSchema(applianceKey)`, parsed `schema.appliance` must equal requested `applianceKey` | If encountered while enumerating a canonical file for that key, omit summary and add warning with `SCHEMA_APPLIANCE_KEY_MISMATCH` | Return `ok: false` with `failure.code = SCHEMA_APPLIANCE_KEY_MISMATCH` |

Additional bootstrap/path outcomes that must stay deterministic:

- requested key outside the canonical MVP set returns `UNKNOWN_APPLIANCE_KEY`, with `failure.applianceKey` set to the exact caller-supplied string argument
- missing shipped schema directory at runtime returns `SHIPPED_SCHEMA_SOURCE_MISSING` only for canonical keys whose local schema file is missing and therefore still require bootstrap
- copy failure during bootstrap returns `SCHEMA_BOOTSTRAP_COPY_FAILED` only for canonical keys whose local schema file is missing and whose bootstrap copy attempt actually fails
- missing canonical local schema file after bootstrap attempt returns `LOCAL_SCHEMA_NOT_FOUND`

This means malformed local schemas that parse but miss required fields are never treated as successful loads: `listSchemas()` omits them with a warning, and `loadSchema()` fails the call with the same canonical contract-invalid code.

Do not expand this issue into broader authoring-time schema linting beyond what is needed for reliable storage/load results.

## 5. Planned file touch list

### Expected files to change

- `.opencode/plans/issue-10.md` (this plan only; already in progress)
- `src/main/index.js`
- `src/main/schemaStorage.js` (new)
- `src/preload/index.js`
- `electron-builder.json` (required: add packaged schema asset configuration for production runtime)
- focused test file(s), preferably under `src/main/` or a small top-level `test/` area
- `package.json` only if a minimal `test` script is required for the chosen narrow test approach

### Files that should remain untouched for this issue

- `src/renderer/**`
- `schemas/*.schema.json`
- `schemas/fixtures/**`
- option/preset persistence files or future storage modules

## 6. Implementation sequence

1. Create a schema storage helper module in `src/main/` with pure helper functions for:
   - shipped schema path resolution
   - local schema path resolution
   - per-key bootstrap copy-if-missing
   - schema parse/validation
   - stable envelope creation
2. Update `src/main/index.js` to register `ipcMain.handle('schema:list', ...)` and `ipcMain.handle('schema:load', ...)`.
3. Update `src/preload/index.js` to preserve existing `platform`, `versions`, and `onUpdateCounter`, and add:
   - `listSchemas: () => ipcRenderer.invoke('schema:list')`
   - `loadSchema: (applianceKey) => ipcRenderer.invoke('schema:load', applianceKey)`
4. Add the required packaged-asset support in `electron-builder.json` so `schemas/*.schema.json` is copied to `${process.resourcesPath}/schemas` for packaged runtime.
5. Add focused tests for bootstrap/list/load behavior, IPC handler registration, preload exposure, and runtime path resolution.
6. Verify the result against the acceptance checklist in section 8 before closing the issue.

## 7. Test plan

Use narrow main-layer tests; do not introduce renderer UI or end-to-end scope for this issue.

Preferred test style:

- Node built-in test runner (`node:test`) unless an equally small existing approach is already present during implementation
- temp directories/fixtures to simulate shipped schema dir and local app-profile dir
- direct function tests for schema storage helpers plus small module-contract tests for main/preload wiring instead of BrowserWindow-driven integration tests

Required test coverage:

1. **Bootstrap copies only missing schema files**
   - local dir starts empty
   - shipped schema files are copied
   - `fixtures/` and `README.md` are ignored
2. **Bootstrap does not overwrite existing local schema files**
   - local schema differs from shipped schema
   - rerun bootstrap
   - local file remains unchanged
3. **Bootstrap leaves unrelated local files untouched**
   - extra local file exists in schema dir
   - bootstrap does not delete or rewrite it
4. **`listSchemas()` returns valid summaries plus warnings**
      - one valid schema, one invalid/unreadable/missing schema
      - valid summary still returned
      - warning object includes `code`
      - schema missing `displayName`, `schemaVersion`, `appliance`, or `dimensions` is omitted rather than partially summarized
      - `schemas` and `warnings` order follows canonical key order: `washer`, `dryer`, `laundry-set`
5. **Existing local schemas remain available when shipped source is missing**
     - one or more canonical local schema files already exist
     - shipped schema source directory is missing/unavailable
     - `listSchemas()` still returns summaries for existing locals
     - `loadSchema(applianceKey)` still succeeds for an existing local key
     - no shipped-source/bootstrap warning or failure is emitted for keys already satisfied by local files
6. **`loadSchema(applianceKey)` succeeds after bootstrap of missing local file**
     - local requested schema missing
     - shipped schema present
     - result returns `ok: true` and full schema
7. **Failures apply only to keys that still need bootstrap**
     - at least one canonical local schema exists and at least one other canonical local schema is missing
     - shipped schema source is missing or copy fails
     - existing-local keys still succeed in `listSchemas()` / `loadSchema()`
     - only missing-local keys receive `SHIPPED_SCHEMA_SOURCE_MISSING`, `SCHEMA_BOOTSTRAP_COPY_FAILED`, or `LOCAL_SCHEMA_NOT_FOUND`
8. **`loadSchema(applianceKey)` returns structured failure for bad requested schema outcomes**
       - invalid JSON
       - parseable non-object JSON root
       - unreadable/missing requested file after bootstrap attempt
       - unknown appliance key
       - `UNKNOWN_APPLIANCE_KEY` returns `failure.applianceKey` equal to the exact caller-supplied string argument
       - parseable schema missing `displayName`, `schemaVersion`, `appliance`, or `dimensions`
       - parsed schema whose `appliance` does not match the requested key
       - all return `ok: false` with `failure.code`
9. **Main-process IPC contract is registered explicitly**
     - test `src/main/index.js` (or a narrow extracted registration helper) with mocked Electron APIs
     - verify `ipcMain.handle('schema:list', handler)` and `ipcMain.handle('schema:load', handler)` are registered
     - avoid relying only on helper tests that never exercise IPC registration
10. **Preload exposure preserves existing APIs and adds schema methods**
     - test `src/preload/index.js` with mocked `contextBridge`/`ipcRenderer`
     - verify `electronAPI` still exposes `platform`, `versions`, and `onUpdateCounter`
     - verify `electronAPI.listSchemas` and `electronAPI.loadSchema` are exposed and invoke `schema:list` / `schema:load`
11. **Runtime path resolution is covered in both dev and packaged modes**
     - verify development resolution finds repo-root `schemas/` from the built main-process runtime location rather than incorrectly depending on `src/main/`
     - verify packaged runtime resolves shipped schemas from `${process.resourcesPath}/schemas`
     - avoid leaving either dev-path or packaged-path logic untested

## 8. Acceptance checklist mapped to issue #10

- [ ] First run copies shipped schema files into the active app profile only when the local schema file is missing.
- [ ] Subsequent runs leave existing local schema files untouched even if shipped schema files changed.
- [ ] Bootstrap touches only shipped MVP schema files and does not delete/overwrite unrelated local files.
- [ ] Bootstrap is copy-if-missing per canonical key: if a local schema file already exists for a key, that local file is read directly and shipped schema resolution is skipped for that key.
- [ ] `listSchemas()` enumerates only the canonical MVP schema files (`washer`, `dryer`, `laundry-set`) after bootstrap rather than arbitrary extra local schema files.
- [ ] `listSchemas()` returns a stable envelope with top-level `schemas` and `warnings`.
- [ ] `listSchemas().schemas` and `listSchemas().warnings` are deterministic and follow canonical key order (`washer`, `dryer`, `laundry-set`), filtered to the entries actually returned.
- [ ] Every returned schema summary includes `applianceKey`, `displayName`, and `schemaVersion`, and omits the full schema document.
- [ ] `listSchemas()` still returns available schema references when another schema file is missing/invalid/unreadable, with per-file warnings instead of unexpected IPC rejection.
- [ ] Existing local schemas remain listable/loadable even when the shipped schema source later becomes unavailable.
- [ ] When shipped schema assets are unavailable or bootstrap copy fails, warnings/failures apply only to canonical keys whose local schema file is still missing.
- [ ] A schema with a parseable but non-object root, or missing/invalidating any minimum required field (`appliance`, `displayName`, `schemaVersion`, `dimensions`), is omitted from `listSchemas()` with `SCHEMA_CONTRACT_INVALID` and never returned as a partial summary.
- [ ] `loadSchema(applianceKey)` returns a stable envelope with top-level `ok`, `schema`, `warnings`, and `failure`.
- [ ] `loadSchema(applianceKey)` uses `warnings` only for non-fatal success metadata; for issue #10 the field is always `[]`, and blocking conditions are returned via `failure` instead.
- [ ] Missing local schema + successful bootstrap returns a successful loaded schema.
- [ ] Missing/invalid/unreadable/unbootstrappable requested schema outcomes return structured business results rather than unexpected IPC rejection.
- [ ] `loadSchema(applianceKey)` reserves `SCHEMA_JSON_PARSE_FAILED` for syntactically invalid JSON only; a parseable non-object root or missing/invalid minimum required field fails with `SCHEMA_CONTRACT_INVALID`, and an `appliance` mismatch fails with `SCHEMA_APPLIANCE_KEY_MISMATCH`.
- [ ] `UNKNOWN_APPLIANCE_KEY` failures include `failure.applianceKey` equal to the exact caller-supplied string argument.
- [ ] Packaged builds ship `schemas/*.schema.json` via `electron-builder` and runtime resolution uses `${process.resourcesPath}/schemas`.
- [ ] Development runtime resolution is verified against the built main-process runtime context so repo-root `schemas/` still resolves correctly outside `src/main/`.
- [ ] `src/main/index.js` registers `ipcMain.handle('schema:list', ...)` and `ipcMain.handle('schema:load', ...)`.
- [ ] `src/preload/index.js` preserves `platform`, `versions`, and `onUpdateCounter`, and adds `listSchemas()` / `loadSchema(applianceKey)` on the same `window.electronAPI` object.
- [ ] Every warning and failure object uses the canonical `{ code, message, applianceKey }` shape, using only the fixed canonical code set from section 4.7.

## 9. Reviewer notes

Reviewers should reject implementations that:

- overwrite local schema files during bootstrap
- require shipped schema access for a canonical key whose local schema file already exists
- scan or mutate non-schema local files beyond this slice
- expose file system paths or extra mutation APIs through preload
- remove or rename existing non-schema preload APIs instead of extending them
- use IPC rejection for expected business failures covered by the issue
- broaden scope into **Option** or preset persistence
- couple schema storage logic tightly to `BrowserWindow` lifecycle code

## 10. Open risks

1. **Packaged runtime verification risk**
   - The plan now requires `electron-builder` `extraResources` plus `${process.resourcesPath}/schemas` resolution.
   - A focused unit/path test reduces risk, but a real packaged-build smoke check is still the best confirmation.

2. **Contract drift risk on warning/failure shapes**
   - This slice is the first structured storage IPC contract in the repo.
   - Follow-on issues #11 and #12 can still drift if they bypass the fixed canonical code set defined here.
   - Mitigation: centralize envelope/code creation in the schema storage module and treat section 4.7 as normative.

3. **No existing test harness risk**
   - There is no current test setup.
   - Mitigation: keep tests narrow and main-layer only; avoid introducing a broad framework for this issue.
