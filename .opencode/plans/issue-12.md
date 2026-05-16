# Canonical Plan — Issue #12: Implement comparison preset persistence and IPC contract

- Issue: [#12](https://github.com/cracklings3d/appliance-research-tool/issues/12)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #12

## 1. Clarified objective

Implement the persistence-only comparison preset slice in the Electron main/preload boundary so the renderer can load, save, and delete named comparison presets through a stable IPC contract without direct file system access.

This slice must:

- persist comparison presets as one canonical file per supported **Appliance** in the active app profile
- use the current local schema contract from issue #10 as the authority for supported **Dimension** keys during save and for derived `effectiveDimensionKeys` during load
- expose exactly three new renderer-facing preload methods for this slice: `loadPresets(applianceKey)`, `savePreset(applianceKey, presetPayload)`, and `deletePreset(applianceKey, presetId)`
- keep missing-**Dimension** references non-blocking on read by returning warnings plus derived `effectiveDimensionKeys` instead of mutating stored preset data
- return machine-readable warnings, failures, and validation errors as structured result data rather than a separate renderer event channel

## 2. Scope boundaries

### In scope

- canonical active-profile comparison-preset file paths and top-level file invariants
- main-process preset storage logic and preload bridge exposure
- stable result envelopes and canonical metadata object shapes/codes
- narrow schema-dependency validation needed for preset save/load against current schema **Dimension** IDs
- derived `effectiveDimensionKeys` behavior and missing-**Dimension** warnings on load
- focused tests for file-contract branches, schema dependency branches, save validation, delete semantics, public code-universe boundaries, IPC registration, and preload exposure

### Out of scope

- comparison renderer behavior, comparison layout, or any winner/scoring logic
- preset selection UI, warning display UI, or preset repair UI
- **Option** persistence, migration, delete-repair, or renderer preset state management
- schema bootstrap/load implementation details beyond consuming the issue-#10 contract
- schema editing, schema mutation, or schema-file persistence
- any broad persistence refactor beyond this comparison preset slice

## 3. Repository facts that constrain the plan

- `CONTEXT.md`, `GLOSSARY.md`, and `schemas/README.md` define the authoritative vocabulary and contracts for **Appliance**, **Option**, **Dimension**, and **Evaluation**.
- `src/main/index.js` already registers schema and option IPC handlers; issue #12 must extend that main-process boundary, not replace it.
- `src/preload/index.js` already exposes `platform`, `versions`, `onUpdateCounter`, `listSchemas()`, `loadSchema(applianceKey)`, `loadOptions(applianceKey)`, `saveOption(applianceKey, optionPayload)`, and `deleteOption(applianceKey, optionId)`; issue #12 must preserve those APIs and extend the same `window.electronAPI` object.
- `src/main/schemaStorage.js` from issue #10 already defines the canonical schema failure codes and top-level schema load contract; issue #12 must reuse those exact schema failure codes.
- The current shipped schemas already expose `defaultComparisonDimensionIds`, but this slice is about persisted named presets, not schema-defined defaults; defaults remain schema concerns and are not rewritten into preset storage.
- The repo already has a narrow `node:test` harness under `test/`; this issue should stay in that focused test style.

## 4. Required implementation shape

### 4.1 Main-process responsibilities and file split

Add a narrowly scoped preset storage module in `src/main/` and keep `src/main/index.js` focused on lifecycle/window wiring plus IPC registration.

Recommended file split:

- `src/main/index.js`
  - preserve existing schema and option handler registration
  - create the shared schema storage instance exactly once inside `registerIpcHandlers()`
  - pass that same schema storage instance into both option storage and preset storage
  - register the three new preset handlers
- `src/main/presetStorage.js` (new)
  - resolve canonical active-profile preset file paths
  - read/validate canonical preset files
  - consume the injected shared schema storage instance for preset save/load dependency checks
  - derive `effectiveDimensionKeys` and missing-**Dimension** warnings
  - validate save payloads and perform canonical persistence writes
  - centralize preset-slice metadata builders and code constants

Do not bury preset file system logic directly inside window bootstrap code or inside renderer-facing preload code.
Do not create a parallel schema-loading path inside `presetStorage.js`; reuse the existing schema-storage functionality already created in `src/main/index.js`.

### 4.2 Canonical active app-profile preset storage location

Use the active Electron profile directory returned by `app.getPath('userData')` and store local comparison preset files under a dedicated `comparison-presets/` child directory.

Planned local directory:

```text
<userData>/comparison-presets/
```

Canonical file mapping for this slice is exactly:

- `washer` -> `<userData>/comparison-presets/washer.comparison-presets.json`
- `dryer` -> `<userData>/comparison-presets/dryer.comparison-presets.json`
- `laundry-set` -> `<userData>/comparison-presets/laundry-set.comparison-presets.json`

No two supported `applianceKey` values may share a file path.

### 4.3 Canonical persisted file contract

Every canonical comparison preset file in this slice uses this exact top-level shape:

```json
{
  "contractVersion": "1.0",
  "appliance": "washer|dryer|laundry-set",
  "presets": []
}
```

Top-level persisted invariants on every read/write in this slice:

- `contractVersion`, `appliance`, and `presets` are required
- `contractVersion` must be the supported string `1.0`
- `appliance` must be one of `washer`, `dryer`, or `laundry-set`
- `appliance` must equal both the canonical file-name key and the requested method-level `applianceKey`
- `presets` must be an array
- every persisted preset record must satisfy the canonical preset-record contract below
- duplicate persisted preset `id` values are a blocking persisted-contract failure

#### 4.3.1 Canonical persisted preset-record contract

The canonical persisted preset-record shape in this slice is exactly:

```json
{
  "id": "stable-preset-id",
  "name": "My preset",
  "applianceKey": "washer",
  "dimensionKeys": ["price", "capacityKg"]
}
```

Record-level invariants:

- `id`, `name`, `applianceKey`, and `dimensionKeys` are required persisted fields
- returned and newly persisted preset records use only `id`, `name`, `applianceKey`, and `dimensionKeys`; `effectiveDimensionKeys` is derived at runtime and is never persisted
- `id` must be an opaque, stable, non-empty string unique within the canonical file
- generated preset-id format is non-normative, but stored IDs must satisfy the invariant above
- `name` must be a string that is already trimmed and remains non-empty
- `applianceKey` must equal the requested canonical `applianceKey` for that file
- `dimensionKeys` must be an array of non-empty strings
- empty `dimensionKeys` is allowed
- duplicate `dimensionKeys` are not allowed
- `dimensionKeys` preserves caller order exactly as saved

If any persisted preset record violates these invariants, the whole file is treated as `PRESETS_CONTRACT_INVALID` for this slice.

#### 4.3.2 Extra-field compatibility policy

To match issue #12's required-field contract without tightening it further, additional persisted top-level fields or additional persisted preset-record fields do not by themselves trigger `PRESETS_CONTRACT_INVALID` in this slice.

Normative consequences:

- `loadPresets()` ignores persisted fields outside the canonical API contract and returns only the documented top-level/result fields plus canonical preset fields and derived `effectiveDimensionKeys`
- `loadPresets()` does not rewrite, repair, or normalize the on-disk file when such extra fields are present
- successful `savePreset()` and `deletePreset()` writes persist only the canonical top-level shape and canonical preset-record fields for the resulting file contents

#### 4.3.3 Normative persisted file-validation precedence

When an existing canonical preset file is read, apply this precedence top-to-bottom. The first matching terminal branch wins.

| Precedence | Existing file branch | Terminal code |
| --- | --- | --- |
| 1 | File cannot be read from disk | `PRESETS_FILE_UNREADABLE` |
| 2 | File content is not syntactically valid JSON | `PRESETS_JSON_PARSE_FAILED` |
| 3 | Parsed root is not an object | `PRESETS_CONTRACT_INVALID` |
| 4 | `contractVersion` is missing or not the supported string `1.0` | `PRESETS_CONTRACT_INVALID` |
| 5 | `appliance` is missing, empty, non-string, or outside `washer`, `dryer`, `laundry-set` | `PRESETS_CONTRACT_INVALID` |
| 6 | `appliance` is canonical but does not equal the canonical file/requested key | `PRESETS_CONTRACT_INVALID` |
| 7 | `presets` is not an array | `PRESETS_CONTRACT_INVALID` |
| 8 | Any preset record is not an object | `PRESETS_CONTRACT_INVALID` |
| 9 | Any preset record has missing/invalid `id`, `name`, `applianceKey`, or `dimensionKeys` | `PRESETS_CONTRACT_INVALID` |
| 10 | Any two preset records share the same `id` | `PRESETS_CONTRACT_INVALID` |
| 11 | None of the above | Continue into normal load/save/delete behavior |

### 4.4 Renderer-facing preload contract and internal IPC channels

`src/preload/index.js` must preserve the existing `electronAPI` fields and add exactly these new methods for this slice:

- `loadPresets(applianceKey)`
- `savePreset(applianceKey, presetPayload)`
- `deletePreset(applianceKey, presetId)`

Recommended internal IPC channel names, following repo conventions:

- `preset:load`
- `preset:save`
- `preset:delete`

Do not expose raw file paths, raw `ipcRenderer`, or any extra preset persistence methods in this slice.

### 4.5 Canonical metadata object shape and fixed code universe

Every returned `warning`, `failure`, and `validationError` object in this slice uses the same canonical field set:

```json
{
  "code": "STRING_CODE",
  "message": "Human-readable but non-normative text",
  "applianceKey": "washer",
  "presetId": "string-or-null",
  "dimensionKey": "string-or-null"
}
```

Field rules:

- `code`, `message`, `applianceKey`, `presetId`, and `dimensionKey` are required on every metadata object in this slice
- `presetId` is `null` when the metadata is call-level or file-level rather than preset-specific
- `dimensionKey` is `null` when the metadata is not tied to one **Dimension**
- for `UNKNOWN_APPLIANCE_KEY`, `applianceKey` must echo the exact rejected caller-supplied string when that input is a string; otherwise use `null`
- for `UNKNOWN_PRESET_ID`, `presetId` must echo the exact submitted `id` when that input is a string; otherwise use `null`
- for `PRESET_NOT_FOUND`, `presetId` must echo the requested delete target when it is a string; otherwise use `null`
- for `PRESET_DIMENSION_MISSING`, populate both `presetId` and `dimensionKey`
- when this slice reuses a schema failure code from issue #10, it must still return this slice’s full metadata shape with `presetId: null` and `dimensionKey: null`
- exact `message` text is non-normative; code and field presence are normative

#### 4.5.1 Metadata value-shaping rules by preset-specific code

Unless stated otherwise below, preset-specific validation metadata must use the exact submitted payload `id` as `presetId` when that input is a string; otherwise `presetId` is `null`.

| Code | `presetId` rule | `dimensionKey` rule |
| --- | --- | --- |
| `UNKNOWN_PRESET_ID` | Echo the exact submitted `id` when that input is a string; otherwise `null` | `null` |
| `PRESET_APPLIANCE_KEY_MISMATCH` | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | `null` |
| `INVALID_PRESET_NAME` | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | `null` |
| `INVALID_DIMENSION_KEYS` for missing/non-array `dimensionKeys` | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | `null` |
| `INVALID_DIMENSION_KEYS` for an invalid array element | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | Echo the exact offending submitted value when that element is a string, including `""` or whitespace-only strings; otherwise `null` |
| `DUPLICATE_DIMENSION_KEY` | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | Echo the exact repeated submitted key |
| `UNKNOWN_DIMENSION_KEY` | Echo the exact submitted payload `id` when that input is a string; otherwise `null` | Echo the exact submitted key that is absent from the validated schema **Dimension** universe |
| `PRESET_DIMENSION_MISSING` | Populate with the owning stored preset ID | Populate with the missing stored **Dimension** key |
| `PRESET_NOT_FOUND` | Echo the requested delete target when it is a string; otherwise `null` | `null` |

Validation-error emission for submitted `dimensionKeys` is per offending occurrence in original array order, not deduplicated by key value. Because the public metadata shape has no index field, repeated offending occurrences may legitimately produce repeated metadata objects with the same `code`, `presetId`, and `dimensionKey`.

Fixed code universe for this slice:

#### Reused schema failure codes from issue #10

- `UNKNOWN_APPLIANCE_KEY`
- `SHIPPED_SCHEMA_SOURCE_MISSING`
- `SCHEMA_BOOTSTRAP_COPY_FAILED`
- `LOCAL_SCHEMA_NOT_FOUND`
- `SCHEMA_FILE_UNREADABLE`
- `SCHEMA_JSON_PARSE_FAILED`
- `SCHEMA_CONTRACT_INVALID`
- `SCHEMA_APPLIANCE_KEY_MISMATCH`

#### Preset-storage failure codes

- `PRESETS_FILE_UNREADABLE`
- `PRESETS_JSON_PARSE_FAILED`
- `PRESETS_CONTRACT_INVALID`
- `PRESET_NOT_FOUND`

#### Preset validation error codes

- `UNKNOWN_PRESET_ID`
- `PRESET_APPLIANCE_KEY_MISMATCH`
- `INVALID_PRESET_NAME`
- `INVALID_DIMENSION_KEYS`
- `DUPLICATE_DIMENSION_KEY`
- `UNKNOWN_DIMENSION_KEY`

#### Preset warning codes

- `PRESET_DIMENSION_MISSING`

The code lists above are exhaustive for the public contract in this slice. Internal write-path mechanics may use narrower implementation diagnostics, but they must not surface as additional public `failure.code` values unless GitHub issue #12 itself is amended.

#### 4.5.2 Code-channel usage rules

Use the shared fixed code universe, but only in the channels allowed by the API contracts below:

| API | `warnings` codes | `validationErrors` codes | top-level `failure.code` values |
| --- | --- | --- | --- |
| `loadPresets()` | `PRESET_DIMENSION_MISSING` | none | `UNKNOWN_APPLIANCE_KEY`, reused schema failure codes, `PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, `PRESETS_CONTRACT_INVALID` |
| `savePreset()` | none | `UNKNOWN_PRESET_ID`, `PRESET_APPLIANCE_KEY_MISMATCH`, `INVALID_PRESET_NAME`, `INVALID_DIMENSION_KEYS`, `DUPLICATE_DIMENSION_KEY`, `UNKNOWN_DIMENSION_KEY` | `UNKNOWN_APPLIANCE_KEY`, reused schema failure codes, `PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, `PRESETS_CONTRACT_INVALID` |
| `deletePreset()` | none on success | none | `UNKNOWN_APPLIANCE_KEY`, `PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, `PRESETS_CONTRACT_INVALID`, `PRESET_NOT_FOUND` |

Expected storage and schema branches in this slice must resolve with stable result envelopes rather than rejected IPC promises.

### 4.6 Narrow schema dependency gate for this slice

`loadPresets()` and `savePreset()` depend on the current local schema for the requested supported **Appliance**. `deletePreset()` does not.

Issue #10 remains authoritative for schema bootstrap, read, parse, and top-level schema contract failures. Issue #12 adds one extra schema-dependency gate after `loadSchema(applianceKey)` succeeds and before preset load/save uses schema details.

Explicit wiring rule for this slice:

- `src/main/index.js` must create the schema storage exactly once via `createSchemaStorage(...)` inside `registerIpcHandlers()`
- `registerIpcHandlers()` must pass that same shared `storage` instance into `createPresetStorage({ userDataPath, schemaStorage: storage })`
- `src/main/presetStorage.js` must depend on the injected `schemaStorage.loadSchema` functionality and must not call `createSchemaStorage()` or bootstrap schema files independently

Normative rule for this slice:

- if `loadSchema(applianceKey)` fails, surface that top-level schema failure unchanged except for this slice’s metadata shape
- if `loadSchema(applianceKey)` succeeds but `schema.dimensions` cannot be used to build a stable **Dimension**-key universe, return top-level `SCHEMA_CONTRACT_INVALID`

Minimum required schema-dependency checks for preset load/save:

- `schema.dimensions` must be an array of object records
- every `schema.dimensions[]` entry must have a non-empty string `id`
- dimension IDs must be unique within the schema
- the allowed preset **Dimension** universe for this slice is exactly the set of `schema.dimensions[].id` values after those checks pass
- this slice does not depend on `defaultComparisonDimensionIds` for validation or derivation; persisted preset `dimensionKeys` stand on their own
- this slice does not add any type-specific allow/deny rules for comparison presets; if a **Dimension** exists in the current schema, it is a valid candidate key for this persistence slice

### 4.7 Normalization and derived `effectiveDimensionKeys` behavior

Normalization in this slice is intentionally narrow.

#### 4.7.1 Persisted vs returned preset shapes

- persisted preset records contain only `id`, `name`, `applianceKey`, and `dimensionKeys`
- returned preset objects from `loadPresets()` and `savePreset()` contain those four fields plus derived `effectiveDimensionKeys`
- `effectiveDimensionKeys` is never persisted to disk in this slice
- `savePreset()` must strip any extra payload fields before persistence rather than writing them to disk

#### 4.7.2 `name` normalization

- `savePreset()` trims `name` before validation and persistence
- persisted `name` is always the trimmed value
- `loadPresets()` returns the stored trimmed value as-is; it does not re-trim or repair invalid stored names because invalid stored files already fail as `PRESETS_CONTRACT_INVALID`

#### 4.7.3 `dimensionKeys` and `effectiveDimensionKeys`

- `dimensionKeys` preserves persisted/submitted order exactly
- empty `dimensionKeys` is allowed and produces `effectiveDimensionKeys: []`
- `effectiveDimensionKeys` is the ordered subset of `dimensionKeys` whose keys still exist in the current schema’s validated **Dimension**-key universe
- `effectiveDimensionKeys` preserves the original relative order from `dimensionKeys`
- `loadPresets()` must not auto-add schema defaults, sort keys, or repair stored `dimensionKeys`
- if all stored keys for a preset are missing from the current schema, the preset still loads successfully with `effectiveDimensionKeys: []`

#### 4.7.4 Missing-**Dimension** warnings on load

- when a stored `dimensionKey` no longer exists in the current schema, omit it from `effectiveDimensionKeys`
- emit one `PRESET_DIMENSION_MISSING` warning for each omitted stored key
- each warning must identify the owning `presetId` and the missing `dimensionKey`
- warnings are ordered by persisted preset order, then by stored `dimensionKeys` order within each preset
- these warnings are non-blocking and do not rewrite on-disk preset data

#### 4.7.5 Save-path consequence

Because `savePreset()` validates submitted `dimensionKeys` against the current schema, every successful save in this issue returns `effectiveDimensionKeys` equal to the returned `dimensionKeys`, and `warnings` remains `[]`.

### 4.8 Shared `applianceKey` rules for all three APIs

Canonical supported `applianceKey` values for this slice are exactly:

- `washer`
- `dryer`
- `laundry-set`

Unknown/unsupported `applianceKey` behavior:

- for all three APIs, a caller-supplied `applianceKey` outside the canonical set returns `ok: false` with top-level `failure.code = UNKNOWN_APPLIANCE_KEY`
- this branch wins before schema lookup, file creation, file read, or file mutation
- `loadPresets()` and `savePreset()` do not continue into schema loading for an unknown/unsupported `applianceKey`
- `deletePreset()` does not depend on schema loading at all; it still validates `applianceKey` first and returns `UNKNOWN_APPLIANCE_KEY` before any file lookup when the key is unsupported

### 4.9 `loadPresets(applianceKey)` contract

Required top-level fields:

```json
{
  "ok": true,
  "presets": [],
  "warnings": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `failure: null`
- blocking failure shape: `ok: false`, `presets: []`, `warnings: []`, and one structured `failure`
- unknown or unsupported `applianceKey` returns top-level `UNKNOWN_APPLIANCE_KEY`
- if the current local schema for the requested supported **Appliance** cannot be bootstrapped, loaded, parsed, or validated, `loadPresets()` returns the corresponding reused schema top-level `failure`
- if issue-#10 schema load succeeds but this slice’s narrow schema-dependency gate fails, return top-level `SCHEMA_CONTRACT_INVALID`
- if the canonical preset file does not exist and the schema dependency passes, return normal first-run success with `presets: []`, `warnings: []`, and `failure: null`
- if the canonical preset file exists but fails persisted-contract validation, return `ok: false` with the corresponding structured preset-storage failure and do not rewrite the file
- `loadPresets()` is side-effect free for preset storage: it must not create files, create directories, repair invalid storage, normalize persisted documents/records, or rewrite preset data on disk
- returned preset objects include `id`, `name`, `applianceKey`, `dimensionKeys`, and `effectiveDimensionKeys`
- returned preset order preserves persisted file order exactly
- non-blocking warnings in this API are limited to `PRESET_DIMENSION_MISSING`

### 4.10 `savePreset(applianceKey, presetPayload)` contract

Required top-level fields:

```json
{
  "ok": true,
  "preset": null,
  "warnings": [],
  "validationErrors": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `preset` is the saved normalized preset, `warnings: []`, `validationErrors: []`, `failure: null`
- blocking storage/schema failure shape: `ok: false`, `preset: null`, `warnings: []`, `validationErrors: []`, and one structured `failure`
- payload validation failure shape: `ok: false`, `preset: null`, `warnings: []`, `failure: null`, and one or more structured `validationErrors`
- unknown or unsupported `applianceKey` returns top-level `UNKNOWN_APPLIANCE_KEY`
- schema bootstrap/load failures from issue #10 are returned as top-level `failure` results
- if issue-#10 schema load succeeds but this slice’s narrow schema-dependency gate fails, return top-level `SCHEMA_CONTRACT_INVALID`
- if the canonical preset file is missing and validation succeeds, `savePreset()` may create that **Appliance**’s canonical file with the canonical top-level shape
- if an existing canonical preset file fails persisted-contract validation, save fails with a top-level preset-storage `failure`; nothing is rewritten

#### 4.10.1 Create/update identity rules

- only a payload that omits the `id` property entirely counts as create and may receive a new stable preset identifier
- if the payload includes an `id` property, that value must be a string whose trimmed length is greater than zero before it can participate in update matching
- payload with a present `id` of `null`, `undefined`, any non-string, `""`, or a whitespace-only string fails validation with `UNKNOWN_PRESET_ID`
- payload with a present non-empty trimmed string `id` that matches an existing persisted preset => update that preset in place
- payload with a present non-empty trimmed string `id` that does not match an existing persisted preset => validation failure `UNKNOWN_PRESET_ID`; do not fall back to create
- successful create appends the new preset at the end of persisted order
- successful update preserves the existing preset position in persisted order

#### 4.10.2 Validation and normalization order plus emission semantics

1. validate canonical `applianceKey`
2. load and validate the current local schema for the requested **Appliance**, including the narrow dimension-id dependency gate in section 4.6
3. read the existing canonical preset file if present; missing file is treated as an empty list, but invalid existing files are top-level failures
4. normalize the submitted payload narrowly by stripping extra fields and trimming `name`
5. validate the normalized payload against the rules below
6. if any validation blocker remains, write nothing
7. on success, persist the canonical updated file contents and return the saved normalized preset plus derived `effectiveDimensionKeys`

Validation rules:

- `presetPayload` itself must be a non-null object and not an array; otherwise return call-level `INVALID_PRESET_NAME` and `INVALID_DIMENSION_KEYS`
- if `presetPayload.applianceKey` is present and does not exactly match the method argument, return `PRESET_APPLIANCE_KEY_MISMATCH`
- `name` is required, must be a string, is trimmed before persistence, and must remain non-empty after trimming; otherwise return `INVALID_PRESET_NAME`
- `dimensionKeys` is required and must be an array; missing or non-array `dimensionKeys` returns `INVALID_DIMENSION_KEYS`
- every submitted `dimensionKeys[]` entry must be a non-empty string; otherwise return `INVALID_DIMENSION_KEYS`
- empty `dimensionKeys` is allowed
- duplicate submitted `dimensionKeys` are rejected with `DUPLICATE_DIMENSION_KEY`
- every submitted non-duplicate `dimensionKey` must exist in the current schema’s validated **Dimension**-key universe; unknown keys return `UNKNOWN_DIMENSION_KEY`
- collect all validation errors that can be determined after schema/file dependencies pass; write nothing when any validation error exists
- `savePreset()` emits no warnings in this issue; `warnings` is always `[]`

Validation metadata semantics in this section must follow section 4.5.1 exactly.

Validation precedence within `dimensionKeys`:

- if `dimensionKeys` is missing or not an array, return only call-level `INVALID_DIMENSION_KEYS` for that branch
- if `dimensionKeys` is an array, emit one `INVALID_DIMENSION_KEYS` error per offending element occurrence whose value is non-string, `""`, or whitespace-only, preserving original array order
- for the remaining valid strings, treat the first occurrence of each exact key as the only occurrence eligible for unknown-schema evaluation
- every later repeated occurrence of the same exact key emits its own `DUPLICATE_DIMENSION_KEY`, preserving original array order
- a duplicated occurrence is not also reported as `UNKNOWN_DIMENSION_KEY` in the same response
- every remaining non-duplicate key that is absent from the validated schema **Dimension** universe emits its own `UNKNOWN_DIMENSION_KEY`, preserving original array order
- validation output for `dimensionKeys` is per offending occurrence and is never deduplicated into one error per distinct key value

#### 4.10.3 Save write-path contract boundary and exact public mapping

This plan does not expand the public `savePreset()` failure-code contract beyond the issue-approved code universe in section 4.5.

Normative consequences:

- `savePreset()` public `failure.code` values remain limited to `UNKNOWN_APPLIANCE_KEY`, the reused schema failure codes, `PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, and `PRESETS_CONTRACT_INVALID`
- after schema/file dependencies and payload validation pass, every expected preset mutation-path storage failure during save must resolve a stable top-level `failure.code = PRESETS_FILE_UNREADABLE`
- this exact `PRESETS_FILE_UNREADABLE` mapping applies to comparison-preset directory creation failure, staged/temp write failure, canonical file replacement failure, and replacement rollback failure during `savePreset()`
- if an existing canonical preset file is unreadable, invalid JSON, or contract-invalid before mutation begins, preserve the earlier read-path result (`PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, or `PRESETS_CONTRACT_INVALID`) rather than remapping it
- implementation may use atomic-write helpers internally, but any narrower mkdir/write/replace/rollback diagnostics are non-normative here and must collapse into the exact public mapping above instead of introducing mutation-specific public codes or rejected IPC promises
- reviewers should reject implementations that widen the public `savePreset()` contract beyond the issue text

### 4.11 `deletePreset(applianceKey, presetId)` contract

Required top-level fields:

```json
{
  "ok": true,
  "deletedPresetId": null,
  "warnings": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `deletedPresetId` equals the removed preset ID, `warnings: []`, `failure: null`
- blocking failure shape: `ok: false`, `deletedPresetId: null`, `warnings: []`, and one structured `failure`
- unknown or unsupported `applianceKey` returns top-level `UNKNOWN_APPLIANCE_KEY`
- `deletePreset()` does not depend on schema loading; it deletes by persisted preset identity scoped to the requested canonical `applianceKey`
- if the caller supplies `presetId` as `null`, any non-string, `""`, or a whitespace-only string, return `PRESET_NOT_FOUND`, write nothing, and use `failure.presetId = null` for null/non-string inputs or the exact submitted string for empty/whitespace-only string inputs
- `deletePreset()` never creates the `comparison-presets/` directory, never bootstraps a missing canonical file, and never introduces new canonical preset storage on any failure path
- if no persisted preset file exists yet for the requested supported **Appliance**, do not create it and return `PRESET_NOT_FOUND`
- if the canonical preset file exists but is unreadable, invalid JSON, or contract-invalid, return the corresponding structured preset-storage failure and leave the on-disk file unchanged
- if the requested `presetId` does not exist in the requested canonical file, return `PRESET_NOT_FOUND`
- if deleting the final persisted preset succeeds, implementation must rewrite the canonical file to the canonical empty document for that **Appliance** with `presets: []`; successful delete must not remove the canonical file from disk
- after a valid target preset is found, every expected delete mutation-path storage failure during canonical rewrite/replacement must resolve a stable top-level `failure.code = PRESETS_FILE_UNREADABLE`
- expected preset delete failures are returned as structured business results rather than unexpected IPC rejection

#### 4.11.1 Delete failure precedence

Apply delete failure precedence top-to-bottom. The first matching terminal branch wins.

| Precedence | Branch | Terminal code / outcome |
| --- | --- | --- |
| 1 | Caller-supplied `applianceKey` is unknown or unsupported | `UNKNOWN_APPLIANCE_KEY` |
| 2 | Caller-supplied `presetId` is `null`, non-string, `""`, or whitespace-only | `PRESET_NOT_FOUND` |
| 3 | Requested canonical preset file exists but cannot be read | `PRESETS_FILE_UNREADABLE` |
| 4 | Requested canonical preset file content is invalid JSON | `PRESETS_JSON_PARSE_FAILED` |
| 5 | Requested canonical preset file violates the persisted contract | `PRESETS_CONTRACT_INVALID` |
| 6 | Requested canonical preset file is missing | `PRESET_NOT_FOUND` |
| 7 | Requested canonical preset file is valid, but no record with the requested `presetId` exists in it | `PRESET_NOT_FOUND` |
| 8 | Requested canonical preset file is valid, target preset exists, but canonical post-delete rewrite/replacement fails | `PRESETS_FILE_UNREADABLE` |
| 9 | None of the above | Continue into success path |

#### 4.11.2 Delete contract boundary

This plan does not expand the public `deletePreset()` failure-code contract beyond the issue-approved code universe in section 4.5.

Normative consequences:

- `deletePreset()` public `failure.code` values remain limited to `UNKNOWN_APPLIANCE_KEY`, `PRESETS_FILE_UNREADABLE`, `PRESETS_JSON_PARSE_FAILED`, `PRESETS_CONTRACT_INVALID`, and `PRESET_NOT_FOUND`
- any expected post-read delete mutation failure that occurs while rewriting the canonical file, including final-delete rewrite failure, must map to `PRESETS_FILE_UNREADABLE`
- successful deletion of the final remaining preset must leave the canonical preset file present on disk with `presets: []`; successful file removal is not an allowed alternative
- delete semantics remain storage-narrow: no directory creation, no missing-file bootstrap, and no new canonical storage introduced on any failure path
- reviewers should reject implementations that widen the public `deletePreset()` contract or make delete create storage in order to proceed

## 5. Planned file touch list for implementation

### Expected files to change

- `src/main/index.js`
- `src/main/presetStorage.js` (new)
- `src/preload/index.js`
- `test/presetStorage.test.js` (new)
- `test/mainIndex.test.js`
- `test/preload.test.js`

### Files that should remain untouched for this issue

- `src/renderer/**`
- `schemas/**`
- `src/main/optionStorage.js`
- `.opencode/plans/issue-10.md`
- `.opencode/plans/issue-11.md`
- GitHub issue text itself in this stage

## 6. Implementation sequence

1. Create `src/main/presetStorage.js` with helpers for canonical file paths, persisted file validation, schema dependency checks, derived `effectiveDimensionKeys`, stable envelope creation, and canonical write behavior for this slice.
2. Reuse issue #10 schema loading by passing the already-created `storage` instance from `registerIpcHandlers()` into `createPresetStorage(...)` rather than re-implementing or duplicating schema bootstrap logic.
3. Update `src/main/index.js` to keep a single shared schema storage instance, pass it into preset storage, and register `ipcMain.handle('preset:load', ...)`, `ipcMain.handle('preset:save', ...)`, and `ipcMain.handle('preset:delete', ...)` while preserving existing schema and option handlers.
4. Update `src/preload/index.js` to preserve existing fields and add:
   - `loadPresets: (applianceKey) => ipcRenderer.invoke('preset:load', applianceKey)`
   - `savePreset: (applianceKey, presetPayload) => ipcRenderer.invoke('preset:save', applianceKey, presetPayload)`
   - `deletePreset: (applianceKey, presetId) => ipcRenderer.invoke('preset:delete', applianceKey, presetId)`
5. Add focused tests for first-run load behavior, persisted file contract branches, schema dependency branches, derived warning/effective-key behavior, save validation, delete semantics, public code-universe boundaries, IPC registration, and preload exposure.
6. Verify the implementation against section 8 before closing the issue.

## 7. Focused test plan

Use narrow main/preload tests with the existing `node:test` harness. Prefer direct storage-helper tests plus small registration/exposure tests rather than BrowserWindow-driven integration tests.

Required coverage:

1. **Canonical file path mapping and first-run semantics**
    - `loadPresets()` on a missing canonical file returns success with `presets: []`
    - `loadPresets()` is side-effect free and creates no directory/file while reading
    - `savePreset()` can create a missing canonical file after validation succeeds
    - `deletePreset()` on a missing canonical file returns `PRESET_NOT_FOUND` and does not create a file
2. **Persisted file invariant failures map deterministically**
    - unreadable file -> `PRESETS_FILE_UNREADABLE`
    - invalid JSON -> `PRESETS_JSON_PARSE_FAILED`
    - top-level non-object, unsupported `contractVersion`, invalid `appliance`, non-array `presets`, duplicate preset IDs, invalid stored `name`, invalid stored `applianceKey`, invalid stored `dimensionKeys`, or duplicate stored `dimensionKeys` -> `PRESETS_CONTRACT_INVALID`
    - persisted extra top-level or record fields are ignored on read and do not by themselves produce `PRESETS_CONTRACT_INVALID`
3. **Schema dependency behavior is reused and extended narrowly**
   - unknown `applianceKey` echoes the raw caller input in metadata
   - schema load/bootstrap failures from issue #10 are surfaced as top-level failures for `loadPresets()` and `savePreset()`
   - if `schema.dimensions[]` is missing, malformed, contains missing IDs, or duplicate IDs, the affected API returns top-level `SCHEMA_CONTRACT_INVALID`
4. **`loadPresets()` derives `effectiveDimensionKeys` without mutating stored data**
   - returned presets preserve persisted order
   - `effectiveDimensionKeys` preserves stored order of existing keys only
   - missing stored keys emit `PRESET_DIMENSION_MISSING` warnings with `presetId` and `dimensionKey`
   - presets with all keys missing still load successfully with `effectiveDimensionKeys: []`
   - on-disk stored `dimensionKeys` remain unchanged after load
5. **`savePreset()` create/update semantics and normalization**
   - create only when the `id` property is omitted, and successful create appends at end
   - update with known `id` preserves position
   - returned and persisted `name` is trimmed
   - extra submitted payload fields are stripped and not persisted
   - successful save returns `effectiveDimensionKeys` equal to returned `dimensionKeys`
6. **`savePreset()` validation boundaries**
   - non-object payload returns call-level `INVALID_PRESET_NAME` and `INVALID_DIMENSION_KEYS`
   - present mismatched `applianceKey` returns `PRESET_APPLIANCE_KEY_MISMATCH`
   - present malformed or unknown `id` returns `UNKNOWN_PRESET_ID` with required `presetId` shaping
   - missing/non-array `dimensionKeys` -> `INVALID_DIMENSION_KEYS`
   - non-string/empty `dimensionKeys[]` entries -> `INVALID_DIMENSION_KEYS`
    - duplicate `dimensionKeys` -> `DUPLICATE_DIMENSION_KEY` with one emitted error per repeated occurrence after the first
    - unknown schema dimension keys -> `UNKNOWN_DIMENSION_KEY` with one emitted error per offending non-duplicate occurrence
    - invalid `dimensionKeys[]` entries emit `INVALID_DIMENSION_KEYS` per offending occurrence rather than as a deduplicated set
    - invalid payload writes nothing
7. **Top-level dependency failures win over save validation output**
   - invalid existing preset file blocks save before payload validation output
   - schema dependency failure blocks save before payload validation output
8. **`deletePreset()` semantics stay schema-independent**
    - malformed caller `presetId` returns `PRESET_NOT_FOUND` with required metadata shaping
    - schema absence or schema failure does not affect `deletePreset()` behavior
    - delete creates no directory/file when storage is missing or a failure branch wins
    - valid delete removes exactly one preset and echoes `deletedPresetId`
    - deleting the final remaining preset rewrites the canonical file with `presets: []` rather than removing the file
    - unknown target ID returns `PRESET_NOT_FOUND`
  9. **Public result codes stay within the issue-approved contract**
    - `savePreset()` and `deletePreset()` never expose public `failure.code` values outside the issue-approved code universe
    - save mkdir/staged-write/replace/rollback failures and delete rewrite/replace/rollback failures map publicly to `PRESETS_FILE_UNREADABLE`
    - expected storage/schema/business failures still resolve contract-shaped results rather than widening the external API
 10. **Expected failures resolve stable envelopes rather than rejected IPC calls**
     - force read/parse/contract/mutation failures in storage helpers
     - verify `loadPresets()`, `savePreset()`, and `deletePreset()` resolve contract-shaped results for covered branches
 11. **Main/preload wiring remains additive and shared-schema based**
     - `src/main/index.js` creates one schema storage instance and passes it into preset storage rather than creating a parallel schema-loading path
     - `src/main/index.js` registers the three preset handlers without removing schema or option handlers
     - `src/preload/index.js` preserves all existing API fields and adds the three preset methods invoking `preset:load`, `preset:save`, and `preset:delete`

## 8. Acceptance checklist mapped to issue #12

- [ ] This issue remains limited to persistence-only main/preload work for comparison presets.
- [ ] Comparison presets are persisted per active app profile and are not stored in schema files.
- [ ] The canonical storage path is `<userData>/comparison-presets/` with exactly one file per supported **Appliance**.
- [ ] `loadPresets()`, `savePreset()`, and `deletePreset()` operate only on the canonical file for the requested supported `applianceKey`.
- [ ] The persisted top-level file contract is explicit and uses required `contractVersion: "1.0"`, canonical `appliance`, and `presets` fields.
- [ ] The persisted preset-record contract is explicit and stores only `id`, `name`, `applianceKey`, and `dimensionKeys`.
- [ ] `effectiveDimensionKeys` is derived at read/save time and is never persisted.
- [ ] Invalid persisted-contract branches are explicit: unreadable file -> `PRESETS_FILE_UNREADABLE`, invalid JSON -> `PRESETS_JSON_PARSE_FAILED`, any top-level or record-level contract violation -> `PRESETS_CONTRACT_INVALID`.
- [ ] Persisted extra top-level or record fields are explicitly treated as non-blocking compatibility input rather than automatic `PRESETS_CONTRACT_INVALID`, while returned/persisted API shapes remain canonical.
- [ ] The fixed warning/failure/validation code set for this slice is explicit and remains limited to the issue-approved public contract: schema reuse, preset storage failures, save validation codes, and `PRESET_DIMENSION_MISSING`, with no added public mutation-specific failure codes.
- [ ] Expected preset mutation-path storage failures use an explicit existing-code mapping: save mkdir/staged-write/replace/rollback failures and delete rewrite/replace/rollback failures resolve as top-level `PRESETS_FILE_UNREADABLE` rather than rejected IPC promises or new public codes.
- [ ] `loadPresets()`, `savePreset()`, and `deletePreset()` all explicitly define unknown/unsupported `applianceKey` behavior using `UNKNOWN_APPLIANCE_KEY`.
- [ ] `deletePreset()` explicitly defines schema-independent behavior and does not rely on schema loading.
- [ ] `loadPresets()` and `savePreset()` explicitly define schema-unavailable behavior by reusing the corresponding schema failure codes from issue #10.
- [ ] `loadPresets()` is explicitly side-effect free for preset storage: no file creation, no directory creation, no repair, and no on-disk normalization.
- [ ] Missing-**Dimension** preset references remain non-blocking load warnings; they are surfaced through `PRESET_DIMENSION_MISSING` metadata and omitted from `effectiveDimensionKeys`.
- [ ] Returned preset ordering is explicit: loads preserve persisted order, creates append, and updates preserve position.
- [ ] `savePreset()` trims `name`, validates submitted `dimensionKeys` against the current schema, and persists no partial change when validation fails.
- [ ] Metadata shaping is explicit for `UNKNOWN_PRESET_ID`, `PRESET_APPLIANCE_KEY_MISMATCH`, `INVALID_PRESET_NAME`, `INVALID_DIMENSION_KEYS`, `DUPLICATE_DIMENSION_KEY`, `UNKNOWN_DIMENSION_KEY`, `PRESET_NOT_FOUND`, and `PRESET_DIMENSION_MISSING`, including required `presetId`/`dimensionKey` value semantics.
- [ ] Submitted `dimensionKeys` validation errors are emitted per offending occurrence in input order rather than as a deduplicated set.
- [ ] `savePreset()` returns `warnings: []` for all outcomes in this issue scope.
- [ ] `deletePreset()` returns structured `PRESET_NOT_FOUND` for missing file, malformed target ID, or missing target preset without creating directories or storage.
- [ ] Successful deletion of the final remaining preset rewrites the canonical file to the canonical empty document with `presets: []` and does not remove the file.
- [ ] Expected read/write/storage failures in this slice resolve stable envelopes rather than rejected IPC promises.
- [ ] `src/main/index.js` reuses one shared schema storage instance for preset storage instead of creating a parallel schema-loading path.
- [ ] `src/main/index.js` registers `preset:load`, `preset:save`, and `preset:delete` handlers without removing existing handlers.
- [ ] `src/preload/index.js` preserves existing `window.electronAPI` fields and adds `loadPresets()`, `savePreset()`, and `deletePreset()`.

## 9. Reviewer notes

Reviewers should reject implementations that:

- store presets in schema files or a single shared cross-appliance file
- persist `effectiveDimensionKeys` instead of deriving it
- rewrite or silently repair an existing contract-invalid preset file
- treat persisted extra top-level or preset-record fields as contract-invalid when the required issue-#12 invariants still hold
- make `deletePreset()` depend on schema loading
- make `deletePreset()` create directories, bootstrap missing storage, or introduce new canonical storage on failure paths
- auto-add schema defaults or silently drop unknown submitted `dimensionKeys` during save
- change the order of stored `dimensionKeys` or loaded preset records
- expose raw file paths or extra preset mutation APIs through preload
- remove existing schema/option preload APIs instead of extending them
- create a parallel schema-loading path in `presetStorage.js` instead of reusing the shared schema storage instance from `src/main/index.js`
- introduce new public `savePreset()` or `deletePreset()` failure codes beyond the issue-approved contract
- fail to map expected preset mutation-path storage failures to `PRESETS_FILE_UNREADABLE`
- remove the canonical preset file after deleting the final preset instead of rewriting the canonical empty document
- deduplicate submitted `dimensionKeys` validation output instead of emitting per offending occurrence as required above
- use IPC rejection for expected business/storage failures covered by this slice
- broaden scope into comparison UI, renderer behavior, or unrelated persistence work

## 10. Intentionally non-normative items

The following are intentionally left non-normative in this plan:

- exact generated preset-ID format, as long as IDs are stable opaque non-empty strings unique within the canonical file
- exact temp/staging filenames used to achieve atomic writes
- exact internal write-path diagnostics, as long as the public result-code contract is not widened
- exact human-readable `message` text for warnings/failures/validation errors
