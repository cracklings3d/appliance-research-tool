# Canonical Plan — Issue #11: Implement option persistence, migration, and delete-repair IPC contract

- Issue: [#11](https://github.com/cracklings3d/appliance-research-tool/issues/11)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #11

## 1. Clarified objective

Implement the persistence-only **Option** storage slice in the Electron main/preload boundary so the renderer can load, save, and delete **Options** through a stable IPC contract without direct file system access.

This slice must:

- persist **Options** as one JSON file per canonical **Appliance** in the active app profile
- use the current local schema contract from issue #10 as the source of truth for schema loading, plus a narrow issue-#11 schema-dependency gate for the dimension metadata this slice requires
- expose exactly three new renderer-facing preload methods for this slice: `loadOptions(applianceKey)`, `saveOption(applianceKey, optionPayload)`, and `deleteOption(applianceKey, optionId)`
- preserve unresolved blocked persisted records on disk when migration is unsafe
- atomically repair persisted `washer` / `dryer` pointer **Evaluations** on affected **Laundry Set Options** when a referenced **Washer Option** or **Dryer Option** is deleted
- return machine-readable warnings, failures, and validation errors as structured return data rather than a separate renderer event channel

## 2. Scope boundaries

### In scope

- canonical active-profile **Option** file paths and top-level file invariants
- main-process **Option** storage logic, migration guards, validation, and delete-time repair
- preload bridge exposure for the three **Option** APIs in this slice
- stable result envelopes and canonical metadata object shapes/codes for load/save/delete
- safe structural migration during `loadOptions()` only; `saveOption()` validates submitted payloads only against the current schema after narrow top-level normalization
- focused tests for file validation, migration branching, pointer validation, delete-time repair, and atomic failure handling

### Out of scope

- renderer CRUD forms, validation presentation, or delete confirmation UX
- delegated pointer resolution such as `washer.capacity` / `dryer.noiseLevel`
- comparison preset persistence (#12)
- incomplete-state presentation for affected **Laundry Set Options**
- schema editing or schema persistence changes already handled by issue #10
- any broad persistence refactor beyond this **Option** slice

## 3. Repository facts that constrain the plan

- `CONTEXT.md`, `GLOSSARY.md`, and `schemas/README.md` define the authoritative vocabulary and contracts for **Appliance**, **Option**, **Dimension**, and **Evaluation**.
- `src/main/index.js` already registers `schema:list` and `schema:load` handlers through `createSchemaStorage(...)`; issue #11 must extend this main-process boundary, not replace it.
- `src/preload/index.js` already exposes `platform`, `versions`, `onUpdateCounter`, `listSchemas()`, and `loadSchema(applianceKey)`; issue #11 must preserve those existing APIs and extend the same `window.electronAPI` object.
- `src/main/schemaStorage.js` already centralizes canonical schema keys and schema failure codes/results from issue #10, but today it validates only a shallower top-level schema shape; issue #11 must reuse those schema code strings and add only the extra dimension-level schema-dependency enforcement this slice needs.
- The Electron/Vue/Vite ADR keeps storage and IPC in the Electron main/preload layer; renderer code must not bypass preload for file access.
- The repo already has a narrow `node:test` harness under `test/`; issue #11 should stay in that focused test style rather than introducing UI or end-to-end scope.

## 4. Required implementation shape

### 4.1 Main-process responsibilities and file split

Add a narrowly scoped **Option** storage module in `src/main/` and keep `src/main/index.js` focused on lifecycle/window wiring plus IPC registration.

Recommended file split:

- `src/main/index.js`
  - preserve existing schema handler registration
  - register the three new **Option** handlers
- `src/main/optionStorage.js` (new)
  - resolve canonical active-profile **Option** file paths
  - read/validate canonical **Option** files
  - enforce the issue-#11 schema-dependency gate against already-loaded schemas before option validation, migration, or delete-time repair
  - normalize/migrate persisted **Option** records and narrowly normalize submitted top-level **Option** shape
  - validate save payloads against the current local schema
  - perform delete-time pointer repair for affected **Laundry Set Options**
  - centralize the canonical metadata builders and option-slice code constants

For this issue, keep the additional dimension-level schema-contract enforcement in `src/main/optionStorage.js` rather than broadening `schemaStorage.js`. A tiny private helper inside `optionStorage.js` is acceptable; introducing a broader shared persistence/schema framework is out of scope.

### 4.2 Canonical active app-profile **Option** storage location

Use the active Electron profile directory returned by `app.getPath('userData')` and store local **Option** files under a dedicated `options/` child directory.

Planned local directory:

```text
<userData>/options/
```

Canonical file mapping for this slice is exactly:

- `washer` -> `<userData>/options/washer.options.json`
- `dryer` -> `<userData>/options/dryer.options.json`
- `laundry-set` -> `<userData>/options/laundry-set.options.json`

No two supported `applianceKey` values may share a file path.

### 4.3 Canonical top-level **Option** file contract

Every canonical **Option** file in this slice uses this shape:

```json
{
  "contractVersion": "1.0",
  "appliance": "washer|dryer|laundry-set",
  "options": []
}
```

Top-level invariants on every read/write in this slice:

- `contractVersion`, `appliance`, and `options` are required
- `contractVersion` must be the supported string `1.0`
- `appliance` must equal both the requested `applianceKey` and the canonical file-name key for that file
- `options` must be an array
- every persisted `options[].id` must be a non-empty string
- duplicate persisted `options[].id` values are a blocking file-level contract failure
- invalid record shapes inside an otherwise valid `options` array are handled as per-record migration/validation branches, not as a whole-file failure, except malformed persisted IDs or duplicate IDs, which block the file because stable identity becomes ambiguous

#### 4.3.2 Canonical **Option** record top-level shape

For this slice, the canonical top-level shape of an individual persisted/submitted **Option** record is exactly:

```json
{
  "id": "stable-option-id",
  "evaluations": {}
}
```

Normative record-level field handling:

- `id` and `evaluations` are the only canonical top-level **Option** record fields for this slice
- extra top-level fields on persisted or submitted **Option** records are safe-normalization noise, not a separate validation failure branch
- when extra top-level fields are present, `loadOptions()` and `saveOption()` must strip them from the normalized returned/saved record rather than preserve them
- if stripping extra top-level fields is the only normalization change for a record/payload, no migration warning is required

#### 4.3.1 Normative file-validation precedence

When an existing canonical **Option** file is read, apply this precedence top-to-bottom. The first matching terminal branch wins.

| Precedence | Existing file branch | Terminal code |
| --- | --- | --- |
| 1 | File cannot be read from disk | `OPTIONS_FILE_UNREADABLE` |
| 2 | File content is not syntactically valid JSON | `OPTIONS_JSON_PARSE_FAILED` |
| 3 | Parsed root is not an object | `OPTIONS_CONTRACT_INVALID` |
| 4 | `contractVersion` is missing or not the supported string `1.0` | `OPTIONS_CONTRACT_VERSION_UNSUPPORTED` |
| 5 | `appliance` is missing, empty, non-string, or outside `washer`, `dryer`, `laundry-set` | `OPTIONS_CONTRACT_INVALID` |
| 6 | `appliance` is canonical but does not equal the canonical file/requested key | `OPTIONS_APPLIANCE_KEY_MISMATCH` |
| 7 | `options` is not an array | `OPTIONS_CONTRACT_INVALID` |
| 8 | any persisted `options[].id` is missing, empty, or not a string | `OPTIONS_CONTRACT_INVALID` |
| 9 | `options` contains duplicate persisted `id` values | `OPTIONS_CONTRACT_INVALID` |
| 10 | None of the above | Continue into per-record migration/validation |

This resolves the issue ambiguity around missing `appliance`: missing/non-canonical `appliance` is `OPTIONS_CONTRACT_INVALID`, while canonical-but-mismatched `appliance` is `OPTIONS_APPLIANCE_KEY_MISMATCH`.

### 4.3.3 Schema dependency authority for migration, validation, and repair

Issue #10 remains authoritative for schema bootstrap, file-read, JSON-parse, canonical-appliance, and top-level schema-shape failures. Issue #11 adds one extra schema-dependency gate after `loadSchema()` succeeds and before `loadOptions()`, `saveOption()`, or `deleteOption()` uses schema details for migration, validation, or delete-time repair.

Normative rule:

- if the requested schema or any dependent schema lacks, malforms, or internally contradicts the dimension metadata required by this slice, return a top-level reused schema failure for that schema’s `applianceKey`
- use `SCHEMA_CONTRACT_INVALID` for these issue-#11 schema-dependency failures unless issue #10 already produced a narrower reused schema failure earlier in the call path
- do not downgrade these schema-dependency failures into option-level `validationErrors`, migration warnings, or pointer-target lookup results

Authoritative requiredness rule for this slice:

- requiredness used by `REQUIRED_DIMENSION_MISSING` and migration requiredness checks is derived by a required-consistency rule that uses both `schema.requiredDimensionIds` and `schema.dimensions[].required`
- `requiredDimensionIds` must be an array of unique non-empty strings, and every referenced ID must exist in `dimensions[]`; otherwise the schema dependency is invalid
- every dimension entry used by this slice must expose a boolean `required`; otherwise the schema dependency is invalid
- for every dimension in the schema, `dimension.required === true` must match presence in `requiredDimensionIds`, and `dimension.required === false` must match absence from `requiredDimensionIds`
- any disagreement between those two sources makes the schema unusable for this slice and returns top-level `SCHEMA_CONTRACT_INVALID`
- once that consistency check passes, the slice may treat the normalized per-dimension `required` flag as the authoritative requiredness signal for validation/migration decisions

Authoritative pointer-metadata rule for this slice:

- pointer detection comes only from `schema.dimensions[].type === "pointer"`; `requiredDimensionIds` does not determine pointer-ness
- pointer dimensions are only valid for this slice on the `laundry-set` schema, which must expose `pointerDimensionsAllowed: true`; any pointer dimension on another schema, or any laundry-set pointer dimension without that allowance, makes the schema dependency invalid
- the only pointer dimensions this slice may use for referential validation and delete-time repair are the canonical `laundry-set` dimensions with `id` values `washer` and `dryer`
- each of those dimensions must expose a non-empty string `targetAppliance`, and it must exactly match the canonical target appliance implied by the dimension ID: `washer -> washer`, `dryer -> dryer`
- if either authoritative laundry-set pointer dimension is missing, duplicated, not typed as `pointer`, missing `targetAppliance`, or has an invalid/mismatched `targetAppliance`, every API branch that depends on that schema metadata fails with top-level `SCHEMA_CONTRACT_INVALID`
- `saveOption()` washer/dryer referential checks and `deleteOption()` repair planning must use only that validated pointer metadata and must not infer pointer behavior from persisted option data alone

### 4.4 Renderer-facing preload contract and internal IPC channels

`src/preload/index.js` must preserve the existing `electronAPI` fields and add exactly these new methods for this slice:

- `loadOptions(applianceKey)`
- `saveOption(applianceKey, optionPayload)`
- `deleteOption(applianceKey, optionId)`

Recommended internal IPC channel names, following repo conventions:

- `option:load`
- `option:save`
- `option:delete`

Do not expose raw file paths, raw `ipcRenderer`, or any extra persistence methods in this slice.

### 4.5 Canonical metadata object shape and fixed code universe

Every returned `warning`, `failure`, and `validationError` object in this slice uses the same canonical field set:

```json
{
  "code": "STRING_CODE",
  "message": "Human-readable but non-normative text",
  "applianceKey": "washer",
  "optionId": "string-or-null",
  "dimensionId": "string-or-null"
}
```

Field rules:

- `code`: required string from the fixed code set below
- `message`: required human-readable text, but exact text is non-normative
- `applianceKey`: required on all metadata objects
- `optionId`: required and `null` when the metadata is file-level or call-level rather than record-specific
- `dimensionId`: required and `null` when the metadata is not tied to one **Dimension**
- for `UNKNOWN_APPLIANCE_KEY`, `applianceKey` must echo the exact rejected caller-supplied string when the rejected input is a string; use `null` when the rejected input is `null` or any non-string
- for `OPTION_NOT_FOUND` in `deleteOption()`, `optionId` should echo the requested target ID because the failure is record-specific
- for `UNKNOWN_OPTION_ID` in `saveOption()`, use `dimensionId: null`; set `optionId` to the exact submitted string when the rejected `id` is any string (including empty or whitespace-only), otherwise use `optionId: null`
- for per-record migration warnings, populate `optionId` when the persisted record’s ID is available; otherwise use `null`
- when this slice surfaces reused schema failure codes from issue #10, it must still return this slice’s full canonical metadata shape, with `optionId: null` and `dimensionId: null`
- for save/delete storage-mutation failures after a target **Option** ID is known, `failure.optionId` should echo that target ID; for create-path failures before a new ID is assigned, use `optionId: null`

Fixed code universe for this slice:

#### Reused schema dependency codes from issue #10

- `UNKNOWN_APPLIANCE_KEY`
- `SHIPPED_SCHEMA_SOURCE_MISSING`
- `SCHEMA_BOOTSTRAP_COPY_FAILED`
- `LOCAL_SCHEMA_NOT_FOUND`
- `SCHEMA_FILE_UNREADABLE`
- `SCHEMA_JSON_PARSE_FAILED`
- `SCHEMA_CONTRACT_INVALID`
- `SCHEMA_APPLIANCE_KEY_MISMATCH`

#### Option-file and migration codes

- `OPTIONS_FILE_UNREADABLE`
- `OPTIONS_JSON_PARSE_FAILED`
- `OPTIONS_CONTRACT_INVALID`
- `OPTIONS_APPLIANCE_KEY_MISMATCH`
- `OPTIONS_CONTRACT_VERSION_UNSUPPORTED`
- `OPTIONS_DIRECTORY_CREATE_FAILED`
- `OPTIONS_STAGE_WRITE_FAILED`
- `OPTIONS_REPLACE_FAILED`
- `OPTIONS_ROLLBACK_FAILED`
- `OPTION_MIGRATION_APPLIED`
- `OPTION_MIGRATION_BLOCKED`
- `OPTION_NOT_FOUND`

#### Validation error codes

- `UNKNOWN_OPTION_ID`
- `UNKNOWN_DIMENSION_ID`
- `INVALID_EVALUATION_SHAPE`
- `REQUIRED_DIMENSION_MISSING`
- `POINTER_TARGET_REQUIRED`
- `POINTER_TARGET_NOT_FOUND`

#### 4.5.1 Issue-contract reconciliation note

- This plan removes `INVALID_OPTION_ID` from the save-path contract to stay aligned with issue #11’s fixed validation-code universe.
- In this revised plan, any caller-supplied save-path `id` that is present but unusable for update matching (null, non-string, empty string, whitespace-only string) is reported as `UNKNOWN_OPTION_ID` rather than as a new validation code.
- The GitHub issue text is intentionally not edited in this stage.
- For issue #11 implementation and review, this canonical plan formally supersedes the issue body’s narrower write-path failure-code list for `OPTIONS_DIRECTORY_CREATE_FAILED`, `OPTIONS_STAGE_WRITE_FAILED`, `OPTIONS_REPLACE_FAILED`, and `OPTIONS_ROLLBACK_FAILED`.
- Reviewers and implementers must treat this file, not the unrevised issue body, as the normative public contract for those four mutation-failure codes within this slice.

#### 4.5.2 Code-channel usage rules

Use the shared fixed code universe, but only in the channels allowed by the API contracts below:

| API | `warnings` codes | `validationErrors` codes | top-level `failure.code` values |
| --- | --- | --- | --- |
| `loadOptions()` | `OPTION_MIGRATION_APPLIED`, `OPTION_MIGRATION_BLOCKED` | none | `UNKNOWN_APPLIANCE_KEY`, schema dependency codes, option-file codes |
| `saveOption()` | none | `UNKNOWN_OPTION_ID`, `UNKNOWN_DIMENSION_ID`, `INVALID_EVALUATION_SHAPE`, `REQUIRED_DIMENSION_MISSING`, `POINTER_TARGET_REQUIRED`, `POINTER_TARGET_NOT_FOUND` | `UNKNOWN_APPLIANCE_KEY`, schema dependency codes, option-file codes |
| `deleteOption()` | none on success | none | `UNKNOWN_APPLIANCE_KEY`, schema dependency codes, option-file codes, `OPTION_NOT_FOUND` |

`OPTION_MIGRATION_BLOCKED` is intentionally a `loadOptions()` warning only. It is not used by `saveOption()` or as a top-level `failure.code` in this slice.

Ordering semantics for metadata arrays are intentionally non-normative in this issue:

- consumers and tests must not rely on the relative order of `warnings` or `validationErrors`
- presence, code/field shaping, and record inclusion/exclusion rules are normative; array sequence is not

### 4.6 `loadOptions(applianceKey)` contract

Required top-level fields:

```json
{
  "ok": true,
  "options": [],
  "warnings": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `failure: null`
- blocking failure shape: `ok: false`, `options: []`, `warnings: []`, `failure` is one structured object
- unknown or unsupported `applianceKey` returns `ok: false` with `failure.code = UNKNOWN_APPLIANCE_KEY`
- all schema bootstrap/load failures from issue #10 are returned as top-level `failure` results and reuse the exact schema codes from that slice
- if the requested schema passes issue #10 loading but fails the issue-#11 schema-dependency gate in section 4.3.3, return `ok: false` with top-level `failure.code = SCHEMA_CONTRACT_INVALID`
- if the canonical **Option** file does not exist and the schema is valid, return `ok: true`, `options: []`, `warnings: []`, `failure: null`
- if the canonical **Option** file exists but fails top-level file validation, return `ok: false` with the corresponding option-file `failure.code`; do not silently rewrite the file and do not degrade to an empty list
- once top-level file validation succeeds, process records independently in persisted order:
  - already-valid records are returned unchanged
  - safely migratable records are returned in normalized form
  - unsafely migratable records are omitted from `options`
- warning granularity is per affected migration branch: if one **Option** is affected in two distinct **Dimensions**, emit two warning objects; if the affected branch is record-level and no single **Dimension** is identifiable, emit one warning object with `dimensionId: null`
- mixed migration precedence is record-scoped: if one persisted record hits both one or more safe migration branches and any unsafe migration branch in the same pass, omit that record and emit only `OPTION_MIGRATION_BLOCKED` warning objects for that record; suppress all `OPTION_MIGRATION_APPLIED` warnings for that omitted record
- if the only effect of schema evolution is that a newly added optional **Dimension** remains absent and no returned record shape changes, no warning is required
- `loadOptions()` preserves persisted file order for all successfully returned records; it does not sort
- safe `loadOptions()` migrations are in-memory only in this issue; the call must not write migrated records back to disk
- `loadOptions()` must not rewrite unresolved blocked records on disk

### 4.7 `saveOption(applianceKey, optionPayload)` contract

Required top-level fields:

```json
{
  "ok": true,
  "option": null,
  "warnings": [],
  "validationErrors": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `option` is the saved normalized **Option**, `validationErrors: []`, `failure: null`
- blocking storage/schema failure shape: `ok: false`, `option: null`, `validationErrors: []`, `failure` is one structured object
- payload validation failure shape: `ok: false`, `option: null`, `failure: null`, `validationErrors` contains one or more structured objects
- unknown or unsupported `applianceKey` returns `failure.code = UNKNOWN_APPLIANCE_KEY`
- schema bootstrap/load/validation failures for the requested **Appliance** return top-level `failure` results using the reused schema codes
- if the requested schema passes issue #10 loading but fails the issue-#11 schema-dependency gate in section 4.3.3, return top-level `failure.code = SCHEMA_CONTRACT_INVALID` for the requested `applianceKey`
- `optionPayload` itself must be a non-null object and not an array; if the caller supplies `null`, an array, or any primitive, return `ok: false`, `failure: null`, and `validationErrors` containing `INVALID_EVALUATION_SHAPE` at call level with `optionId: null` and `dimensionId: null`
- if the canonical **Option** file is missing and validation succeeds, `saveOption()` may create that appliance’s canonical file with the canonical top-level shape
- if an existing canonical **Option** file fails top-level file validation, save fails with a top-level option-file `failure`; nothing is rewritten

Create/update identity rules:

- only a payload that omits the `id` property entirely counts as create and may receive a new stable app-level **Option** identifier
- if the payload includes an `id` property, that value must be a string whose trimmed length is greater than zero before it can participate in update matching
- payload with a present `id` of `null`, `undefined`, any non-string, `""`, or a whitespace-only string fails validation with `UNKNOWN_OPTION_ID`; use `dimensionId: null`, `optionId: null` for `null`/`undefined`/non-string values, and echo the exact submitted string in `optionId` for empty/whitespace-only string values
- payload with a present non-empty trimmed string `id` that matches an existing persisted record => update that record in place
- payload with a present non-empty trimmed string `id` that does not match an existing persisted record => `validationErrors` includes `UNKNOWN_OPTION_ID` with `optionId` echoing the submitted string and `dimensionId: null`
- successful create appends the new record at the end of persisted order
- successful update preserves the existing record position in persisted order

Validation and normalization order:

1. load and validate the current local schema for the requested **Appliance**
2. read the existing canonical **Option** file if present; missing file is treated as an empty list, but invalid existing files are top-level failures
3. apply only the narrow canonical top-level normalization from section 4.3.2 to the submitted payload (for example, strip extra top-level **Option** fields); do not apply schema-evolution migration heuristics to submitted `evaluations`
4. validate the normalized payload against the current schema and required referential checks
5. if any validation blocker remains, write nothing
6. on success, persist the normalized updated file contents and return the saved normalized record

Normative save-path stale-payload rule:

- `saveOption()` must classify submitted `evaluations` only from the current schema named in this plan; it must not infer prior-schema intent
- submitted unknown **Dimension** keys are ordinary `UNKNOWN_DIMENSION_ID` validation errors, not save-path migration
- submitted wrapper/type mismatches are ordinary `INVALID_EVALUATION_SHAPE` validation errors, not save-path migration
- `OPTION_MIGRATION_APPLIED` and `OPTION_MIGRATION_BLOCKED` are reserved for persisted-file read behavior in `loadOptions()`

Failure/validation precedence:

- if any required dependency for validation resolves to a top-level schema or option-file failure, that top-level `failure` wins over payload `validationErrors` for the whole call
- specifically for `laundry-set` saves, if the submitted payload has local validation problems and a dependent washer/dryer catalog file also exists but fails top-level file validation, return the dependent top-level `failure`, set `validationErrors: []`, and write nothing
- `validationErrors` are only returned after all required dependencies for the attempted validation branch have passed their own top-level schema/file checks

Dependent pointer-target validation for `laundry-set` saves:

- `washer` and `dryer` pointer **Dimensions** are required for save in this slice
- that requirement depends on the authoritative laundry-set pointer metadata from section 4.3.3; if that schema metadata is missing or inconsistent, fail the call with top-level `SCHEMA_CONTRACT_INVALID` rather than option-level pointer validation errors
- each must be present with `status: "known"` and a target **Option** ID, or validation returns `POINTER_TARGET_REQUIRED`
- target IDs must currently exist in the persisted washer/dryer **Option** catalogs, or validation returns `POINTER_TARGET_NOT_FOUND`
- washer target lookup must use the validated `washer` pointer dimension whose `targetAppliance` is `washer`; dryer target lookup must use the validated `dryer` pointer dimension whose `targetAppliance` is `dryer`
- if a referenced washer/dryer **Option** file is missing, treat that as an empty catalog for target lookup
- if a referenced washer/dryer **Option** file exists but fails top-level file validation, fail the save with a top-level option-file `failure` using the dependent file’s `applianceKey`; do not collapse that branch into `POINTER_TARGET_NOT_FOUND`

Warnings:

- `saveOption()` does not emit migration warnings in this issue
- `warnings` is always `[]` for `saveOption()`

#### 4.7.1 Normative save mutation-failure branches

Once `saveOption()` has passed schema/file validation and payload validation, any write-path mutation failure must return the standard blocking storage failure shape for this API: `ok: false`, `option: null`, `warnings: []`, `validationErrors: []`, and one structured top-level `failure`.

Allowed structured `failure.code` branches for save-path mutation are:

| Branch | Required `failure.code` | Required behavior |
| --- | --- | --- |
| Creating the canonical `options/` directory for a first save fails | `OPTIONS_DIRECTORY_CREATE_FAILED` | Write nothing; preserve any existing canonical files unchanged |
| Creating or fully writing any required staged/temp file fails | `OPTIONS_STAGE_WRITE_FAILED` | Write nothing to canonical files |
| Replacing the canonical target file with staged content fails, but the pre-call canonical state is successfully restored | `OPTIONS_REPLACE_FAILED` | Return failure after restore; no success result |
| A replace attempt fails and the implementation cannot confirm restoration of the pre-call canonical state | `OPTIONS_ROLLBACK_FAILED` | Return failure immediately; do not downgrade to success or validation output |

For all four save-path mutation failures:

- `failure.applianceKey` must be the requested canonical `applianceKey`
- `failure.dimensionId` must be `null`
- `failure.optionId` must echo the saved target **Option** ID when known, otherwise `null` for create-path failures before ID assignment

### 4.8 `deleteOption(applianceKey, optionId)` contract

Required top-level fields:

```json
{
  "ok": true,
  "deletedOptionId": null,
  "affectedLaundrySetOptionIds": [],
  "repairedLaundrySetOptionIds": [],
  "warnings": [],
  "failure": null
}
```

Normative behavior:

- success shape: `ok: true`, `failure: null`, `warnings: []`, and `deletedOptionId` equals the exact deleted target ID
- in this MVP slice, successful `deleteOption()` never emits non-fatal warnings; `warnings` is always `[]` on success
- every blocking delete branch returns: `ok: false`, `deletedOptionId: null`, `affectedLaundrySetOptionIds: []`, `repairedLaundrySetOptionIds: []`, `warnings: []`, and one structured `failure`
- if both caller-supplied `applianceKey` is unknown/unsupported and caller-supplied `optionId` is `null`, non-string, `""`, or whitespace-only, return `failure.code = UNKNOWN_APPLIANCE_KEY`; do not continue into `OPTION_NOT_FOUND` shaping for that call
- unknown or unsupported `applianceKey` otherwise returns `failure.code = UNKNOWN_APPLIANCE_KEY`
- schema bootstrap/load/validation failure for the requested **Appliance** returns a top-level schema `failure`
- `optionId` must be a string whose trimmed length is greater than zero for caller-supplied delete requests; if the caller supplies `null`, any non-string, `""`, or a whitespace-only string, return `failure.code = OPTION_NOT_FOUND`, write nothing, and use `failure.optionId = null` for null/non-string inputs or the exact submitted string for empty/whitespace-only string inputs
- if deleting a `washer` or `dryer`, delete-time repair also depends on the current local `laundry-set` schema; if that dependent schema cannot be loaded/validated, the delete fails atomically before touching any file
- if that dependent `laundry-set` schema passes issue #10 loading but fails the issue-#11 schema-dependency gate in section 4.3.3, the delete still fails atomically before touching any file with top-level `SCHEMA_CONTRACT_INVALID` for `applianceKey: "laundry-set"`
- if the requested canonical **Option** file exists but fails top-level file validation, abort the delete and return the corresponding option-file `failure` for the requested `applianceKey`
- if the requested canonical **Option** file is missing, return `failure.code = OPTION_NOT_FOUND`
- if the target `optionId` does not exist in the requested canonical file, return `failure.code = OPTION_NOT_FOUND`
- deleting a `laundry-set` **Option** has no cross-file repair work; both laundry-set ID arrays are empty on success
- deleting a `washer` or `dryer` **Option** must inspect persisted `laundry-set` **Options** for references to that `optionId`
- if the canonical `laundry-set` **Option** file is missing, treat that as “no affected **Laundry Set Options**”
- if the canonical `laundry-set` **Option** file exists but fails top-level file validation, abort the delete and return the corresponding option-file `failure` with `applianceKey: "laundry-set"`
- repair planning must use only the validated authoritative laundry-set pointer metadata from section 4.3.3; do not infer repairable pointer dimensions from persisted evaluation keys when the schema metadata is invalid or incomplete
- when repair proceeds, every affected `washer` / `dryer` pointer **Evaluation** is converted to the incomplete persisted state `{ "status": "na" }` in the same successful persisted operation as the source delete
- `affectedLaundrySetOptionIds` reports every **Laundry Set Option** that referenced the deleted `optionId`
- `repairedLaundrySetOptionIds` reports the subset actually persisted in the same successful delete; on success in this slice it must equal `affectedLaundrySetOptionIds`

#### 4.8.1 Normative delete failure precedence

Apply delete failure precedence top-to-bottom. The first matching terminal branch wins.

| Precedence | Branch | Terminal code / outcome |
| --- | --- | --- |
| 1 | Caller-supplied `applianceKey` is unknown or unsupported | `UNKNOWN_APPLIANCE_KEY` |
| 2 | Caller-supplied `optionId` is `null`, non-string, `""`, or whitespace-only | `OPTION_NOT_FOUND`; use `failure.optionId = null` for null/non-string inputs, otherwise echo the exact submitted string |
| 3 | Requested **Appliance** schema dependency fails | Reused top-level schema failure for the requested `applianceKey` |
| 4 | Requested canonical source **Option** file exists but fails top-level file validation | Corresponding top-level option-file failure for the requested `applianceKey` |
| 5 | For `washer` / `dryer` deletes only: dependent `laundry-set` schema dependency fails | Reused top-level schema failure with `applianceKey: "laundry-set"` |
| 6 | For `washer` / `dryer` deletes only: canonical `laundry-set` **Option** file exists but fails top-level file validation | Corresponding top-level option-file failure with `applianceKey: "laundry-set"` |
| 7 | Requested canonical source **Option** file is missing | `OPTION_NOT_FOUND` |
| 8 | Requested source file is valid, but no record with the requested `optionId` exists in it | `OPTION_NOT_FOUND` |
| 9 | None of the above | Continue into success / repair path |

Normative conflict resolution implied by this table:

- unknown or unsupported caller `applianceKey` wins even when caller `optionId` is also malformed
- if `applianceKey` is canonical, malformed caller `optionId` wins before any schema or file lookup, even if the source file or dependent `laundry-set` schema/file is also missing or invalid
- requested source-file top-level failures win before dependent `laundry-set` validation/file failures
- for `washer` / `dryer` deletes, dependent `laundry-set` schema/file failures win over unresolved source-target branches, so return the dependent top-level failure instead of `OPTION_NOT_FOUND` when the source file is missing or the requested target ID is absent in the source file
- `OPTION_NOT_FOUND` for a missing source file or missing target ID is only returned after every dependency needed for the attempted delete branch has cleared its own top-level schema/file checks

#### 4.8.2 Atomic final-state requirement

Delete-time repair must leave no partial persisted state behind.

Observed contract requirement:

- after a successful delete, both the source file delete and any affected `laundry-set` pointer repairs are visible on disk
- after a failed delete, neither the source delete nor any dependent repair is visible on disk

Recommended implementation strategy:

1. load and validate every required schema/file dependency before mutating anything
2. compute the full next-state contents for every touched canonical file in memory
3. stage writes in the same `options/` directory using temporary files
4. replace canonical files only after all staged content is ready
5. if any replace step fails, restore the pre-call on-disk state before returning failure

Exact temp-file names and helper decomposition are non-normative; the no-partial-state outcome is normative.

#### 4.8.3 Normative delete mutation-failure branches

After dependency validation passes and delete/repair next-state content has been computed, any storage mutation failure must return the standard blocking delete failure shape: `ok: false`, `deletedOptionId: null`, `affectedLaundrySetOptionIds: []`, `repairedLaundrySetOptionIds: []`, `warnings: []`, and one structured top-level `failure`.

Allowed structured `failure.code` branches for delete-path mutation are:

| Branch | Required `failure.code` | Required metadata shaping |
| --- | --- | --- |
| Creating the canonical `options/` directory or required staging location fails before first mutation | `OPTIONS_DIRECTORY_CREATE_FAILED` | `failure.optionId` echoes the requested delete target ID; `failure.dimensionId = null` |
| Creating or fully writing any required staged/temp file for the source delete or dependent `laundry-set` repair fails | `OPTIONS_STAGE_WRITE_FAILED` | `failure.optionId` echoes the requested delete target ID; `failure.dimensionId = null` |
| Replacing a canonical file with staged content fails, but the pre-call canonical state is successfully restored | `OPTIONS_REPLACE_FAILED` | `failure.optionId` echoes the requested delete target ID; `failure.dimensionId = null` |
| A replace attempt fails and the implementation cannot confirm restoration of the pre-call canonical state | `OPTIONS_ROLLBACK_FAILED` | `failure.optionId` echoes the requested delete target ID; `failure.dimensionId = null` |

For delete-path mutation failures, `failure.applianceKey` must identify the canonical file branch whose mutation step failed: the requested `applianceKey` for source-file failures, or `laundry-set` when the dependent repair file branch fails.

### 4.9 Migration decision boundaries

Safe migration in this issue is intentionally narrow. Safe migration applies to persisted-file reads in `loadOptions()` only; it does not classify submitted save payloads beyond the top-level normalization already defined for canonical **Option** shape. Safe migration must never invent new values, change an **Option** `id`, or synthesize pointer targets.

| Case | Classification | `loadOptions()` behavior | `saveOption()` behavior |
| --- | --- | --- | --- |
| Schema adds a new optional **Dimension** that is absent in persisted data | Safe persisted-read migration | Return the **Option** without inventing a value for that **Dimension** | Save remains allowed only if the submitted payload is otherwise valid against the current schema; no migration classification is involved |
| Schema removes a previously persisted **Dimension** | Safe persisted-read migration | Drop the obsolete **Evaluation** and emit `OPTION_MIGRATION_APPLIED` for that **Option** / **Dimension** | Submitted payloads carrying that obsolete key fail validation with `UNKNOWN_DIMENSION_ID`; save does not silently drop it |
| Schema changes a **Dimension** type (`boolean`/`enum`/`numeric`/`string`/`pointer`) | Unsafe persisted-read migration | Omit the affected **Option** and emit `OPTION_MIGRATION_BLOCKED` | Submitted wrapper/type mismatches fail validation with `INVALID_EVALUATION_SHAPE`; submitted stale keys that no longer exist fail with `UNKNOWN_DIMENSION_ID` |
| Schema changes a **Dimension** from optional to required under the authoritative requiredness rule in section 4.3.3 and the persisted/submitted **Option** has no valid **Evaluation** for that **Dimension** | Unsafe persisted-read migration / current-schema validation | Omit the affected **Option** and emit `OPTION_MIGRATION_BLOCKED` | Validate against the current schema only; missing required **Dimensions** fail with `REQUIRED_DIMENSION_MISSING` |
| Schema changes a **Dimension** from required to optional | Safe persisted-read migration | Return the **Option** if otherwise valid | Save remains allowed if the submitted payload is otherwise valid against the current schema |
| Persisted/submitted **Evaluation** wrapper is invalid (missing object wrapper, unsupported `status`, `known` without compatible `value`, invalid pointer shape) | Unsafe persisted-read migration / current-schema validation | Omit the affected **Option** and emit `OPTION_MIGRATION_BLOCKED` | Return `validationErrors` with `INVALID_EVALUATION_SHAPE`; write nothing |
| Laundry Set pointer **Dimension** is removed from schema | Safe persisted-read migration | Drop the obsolete pointer **Evaluation** and emit `OPTION_MIGRATION_APPLIED` | Submitted payloads carrying that obsolete pointer key fail validation with `UNKNOWN_DIMENSION_ID`; save does not silently drop it |
| Laundry Set pointer **Dimension** changes target **Appliance**, changes between `pointer` and any non-`pointer` type, or the schema no longer satisfies the authoritative pointer-metadata rule in section 4.3.3 | Unsafe schema dependency | Return top-level `SCHEMA_CONTRACT_INVALID` for `laundry-set` instead of per-record migration output | Return top-level `SCHEMA_CONTRACT_INVALID` for `laundry-set` instead of payload validation output |

#### 4.9.1 Mixed safe + unsafe migration precedence

Migration precedence is decided per persisted record in `loadOptions()`, not per individual warning code.

- `loadOptions()`: if one persisted record hits any unsafe migration branch, that record is omitted from `options` and `OPTION_MIGRATION_APPLIED` warnings for the same record are suppressed, even if the same record also had obsolete **Dimensions** that could have been safely dropped
- safe `OPTION_MIGRATION_APPLIED` metadata may still be emitted for other returned records in the same `loadOptions()` call that do not hit any unsafe branch
- `saveOption()` has no mixed migration branch in this issue because submitted payloads are validated only against the current schema rather than classified as stale migrations

### 4.10 Minimum save validation boundary

Validation for this slice should be narrow and contract-driven.

Minimum required rules:

| Condition | Required outcome |
| --- | --- |
| `optionPayload` is `null`, an array, or any non-object primitive | `validationErrors` includes `INVALID_EVALUATION_SHAPE` at call level (`optionId: null`, `dimensionId: null`) |
| `optionPayload.evaluations` is not an object | `validationErrors` includes `INVALID_EVALUATION_SHAPE` at call level (`optionId` known if present, `dimensionId: null`) |
| Submitted `id` property is present but is `null`, `undefined`, a non-string, or a string whose trimmed value is empty | `validationErrors` includes `UNKNOWN_OPTION_ID`; use `dimensionId: null`, `optionId: null` for `null`/`undefined`/non-string values, and echo the exact submitted string in `optionId` for empty/whitespace-only strings |
| Submitted **Dimension** key does not exist in the current schema after the narrow top-level normalization in section 4.7 | `UNKNOWN_DIMENSION_ID` |
| Submitted **Evaluation** wrapper is not a valid MVP `{ status, value? }` object for the schema **Dimension** type | `INVALID_EVALUATION_SHAPE` |
| Required non-pointer **Dimension** has no wrapper, using authoritative requiredness from section 4.3.3 | `REQUIRED_DIMENSION_MISSING` |
| `laundry-set` save is missing `washer` or `dryer`, or those pointer wrappers are not `status: "known"` with a target ID | `POINTER_TARGET_REQUIRED` |
| `laundry-set` pointer target ID does not exist in the current referenced washer/dryer catalogs | `POINTER_TARGET_NOT_FOUND` |
| Submitted `id` is a non-empty trimmed string but does not match an existing persisted record | `UNKNOWN_OPTION_ID` with `optionId` echoing that submitted string and `dimensionId: null` |

Additional rules:

- collect all validation errors that can be determined from the normalized payload and current dependencies in one response rather than failing fast after the first field-level issue
- the “collect all validation errors” rule only applies after every dependency needed for that validation pass has already cleared its own top-level schema/file checks; top-level dependency failures are returned instead of a mixed `failure` + `validationErrors` response
- do not persist partial changes when any validation error exists
- exact `message` text is non-normative, but `code`, `applianceKey`, `optionId`, and `dimensionId` must remain stable

## 5. Planned file touch list for implementation

### Expected files to change

- `.opencode/plans/issue-11.md` (this plan)
- `src/main/index.js`
- `src/main/optionStorage.js` (new)
- `src/preload/index.js`
- `test/optionStorage.test.js` (new)
- `test/mainIndex.test.js`
- `test/preload.test.js`

### Files that should remain untouched for this issue

- `src/renderer/**`
- `schemas/*.schema.json`
- `schemas/fixtures/**`
- `.opencode/plans/issue-10.md`
- comparison preset persistence files or renderer preset logic

## 6. Implementation sequence

1. Create `src/main/optionStorage.js` with pure helpers for canonical file paths, envelope creation, top-level file validation, per-record migration, save validation, and delete-time repair planning.
2. Reuse issue #10 schema loading/bootstrap logic as a dependency rather than re-implementing schema bootstrap rules inside option storage.
3. Update `src/main/index.js` to register `ipcMain.handle('option:load', ...)`, `ipcMain.handle('option:save', ...)`, and `ipcMain.handle('option:delete', ...)` while preserving the schema handlers.
4. Update `src/preload/index.js` to preserve existing fields and add:
   - `loadOptions: (applianceKey) => ipcRenderer.invoke('option:load', applianceKey)`
   - `saveOption: (applianceKey, optionPayload) => ipcRenderer.invoke('option:save', applianceKey, optionPayload)`
   - `deleteOption: (applianceKey, optionId) => ipcRenderer.invoke('option:delete', applianceKey, optionId)`
5. Add focused tests for file-contract branches, migration branches, save validation, dependent file failures, delete repair semantics, atomic rollback behavior, IPC registration, and preload exposure.
6. Verify the implementation against section 8 before any follow-on work.

## 7. Focused test plan

Use narrow main/preload tests with the existing `node:test` harness. Prefer direct storage-helper tests plus small registration/exposure tests rather than BrowserWindow-driven integration tests.

Required coverage:

1. **Canonical file path mapping and missing-file semantics**
   - `loadOptions()` on missing file returns success with empty `options`
   - `saveOption()` can create a missing canonical file after validation succeeds
   - `deleteOption()` on missing file returns `OPTION_NOT_FOUND` and does not create a file
2. **Top-level file invariant failures map deterministically**
    - unreadable file -> `OPTIONS_FILE_UNREADABLE`
    - invalid JSON -> `OPTIONS_JSON_PARSE_FAILED`
    - unsupported/missing `contractVersion` -> `OPTIONS_CONTRACT_VERSION_UNSUPPORTED`
    - missing/non-canonical `appliance` -> `OPTIONS_CONTRACT_INVALID`
    - canonical-but-mismatched `appliance` -> `OPTIONS_APPLIANCE_KEY_MISMATCH`
    - non-array `options`, malformed persisted IDs, or duplicate IDs -> `OPTIONS_CONTRACT_INVALID`
3. **`loadOptions()` mixed-record behavior**
 - valid records are returned
 - safe migration drops obsolete **Dimensions** and emits `OPTION_MIGRATION_APPLIED`
 - blocked records are omitted and emit `OPTION_MIGRATION_BLOCKED`
 - one record with both a safe drop and a separate unsafe migration branch is omitted and emits only `OPTION_MIGRATION_BLOCKED` for that record
 - extra top-level **Option** record fields are stripped from normalized returned records without a warning when that is the only change
 - returned order matches persisted order of successful records
4. **`saveOption()` create/update semantics**
     - create only when the `id` property is omitted, and successful create appends at end
     - update with known `id` preserves position
     - present malformed `id` values (`null`, `undefined`, empty string, whitespace-only string, or non-string) return `UNKNOWN_OPTION_ID` with the required `optionId`/`dimensionId` shaping
     - unknown `id` returns `UNKNOWN_OPTION_ID`
     - invalid payload writes nothing
     - malformed persisted IDs in the existing target file block save as a top-level `OPTIONS_CONTRACT_INVALID` failure
     - extra top-level submitted **Option** record fields are stripped from the saved normalized record rather than rejected
5. **`saveOption()` validation boundaries**
    - `optionPayload` that is `null`, an array, or a primitive returns call-level `INVALID_EVALUATION_SHAPE`
    - unknown **Dimension** IDs -> `UNKNOWN_DIMENSION_ID`
    - invalid **Evaluation** wrappers -> `INVALID_EVALUATION_SHAPE`
    - missing required non-pointer **Dimensions** -> `REQUIRED_DIMENSION_MISSING`
    - stale submitted payloads are not migration-classified on save; obsolete keys fail as `UNKNOWN_DIMENSION_ID` and wrapper/type mismatches fail as `INVALID_EVALUATION_SHAPE`
    - `saveOption()` emits no migration warnings; `warnings` remains `[]`
6. **`laundry-set` pointer validation**
    - missing washer/dryer pointers -> `POINTER_TARGET_REQUIRED`
    - unknown target IDs -> `POINTER_TARGET_NOT_FOUND`
    - missing referenced washer/dryer catalogs behave as empty catalogs
    - invalid referenced washer/dryer files fail the save with top-level option-file failures rather than pointer validation errors
    - when local payload validation errors coexist with an invalid dependent washer/dryer catalog file, the dependent top-level failure wins and `validationErrors` stays empty
7. **`deleteOption()` self-delete vs dependent repair**
     - caller-supplied unknown/unsupported `applianceKey` wins over malformed `optionId` when both inputs are invalid
     - caller-supplied `optionId` values of `null`, empty string, whitespace-only string, or non-string return `OPTION_NOT_FOUND` with the required `failure.optionId` shaping when `applianceKey` is canonical
     - requested source files that exist but fail top-level validation return the corresponding top-level option-file failure for the requested `applianceKey`
     - successful delete echoes the exact deleted ID in `deletedOptionId`
     - deleting a `laundry-set` **Option** returns empty affected/repaired arrays
     - deleting a washer/dryer with no dependent laundry-set file succeeds with empty affected/repaired arrays
     - deleting a washer/dryer with affected laundry-set records repairs each relevant pointer to `{ status: "na" }`
     - for washer/dryer deletes, an invalid dependent `laundry-set` schema/file wins over `OPTION_NOT_FOUND` when the source file is missing or the requested target ID is absent
     - when both the requested source file and dependent `laundry-set` file are invalid, the requested source-file top-level failure wins
8. **Atomic delete rollback behavior**
    - inject a failure after staging but before the full delete/repair commit completes
    - assert that both the source **Option** and all affected **Laundry Set Options** remain unchanged on disk
 9. **Schema dependency behavior is reused exactly and extended narrowly for this slice**
    - unknown `applianceKey` echoes the raw caller input in metadata
    - schema load/bootstrap failures from issue #10 are surfaced as top-level failures for all three APIs
    - if `requiredDimensionIds` is missing, malformed, contains duplicates, or references unknown dimension IDs, the affected API returns top-level `SCHEMA_CONTRACT_INVALID`
    - if any dimension needed by this slice is missing a boolean `required`, or if `requiredDimensionIds` disagrees with `dimensions[].required`, the affected API returns top-level `SCHEMA_CONTRACT_INVALID`
    - if `laundry-set` pointer metadata is missing/inconsistent (`pointerDimensionsAllowed`, `washer`/`dryer` pointer entries, or `targetAppliance`), the affected save/delete branch returns top-level `SCHEMA_CONTRACT_INVALID`
    - deleting washer/dryer fails before mutation if the dependent `laundry-set` schema cannot be loaded or fails the issue-#11 schema-dependency gate
 10. **Write-path mutation failure codes are deterministic**
     - first-save directory creation failure -> `OPTIONS_DIRECTORY_CREATE_FAILED`
     - staged/temp-file write failure during save/delete -> `OPTIONS_STAGE_WRITE_FAILED`
     - canonical replace failure with confirmed restore -> `OPTIONS_REPLACE_FAILED`
     - replace failure with unconfirmed restore -> `OPTIONS_ROLLBACK_FAILED`
 11. **Main/preload wiring remains additive**
      - `src/main/index.js` registers the three option handlers without removing the schema handlers
      - `src/preload/index.js` preserves `platform`, `versions`, `onUpdateCounter`, `listSchemas`, and `loadSchema`, and adds the three new option methods

## 8. Acceptance checklist mapped to issue #11

- [ ] This issue remains limited to persistence-only main/preload work.
- [ ] Canonical active-profile **Option** directory is `<userData>/options/`.
- [ ] Canonical file mapping is explicit and unambiguous for `washer`, `dryer`, and `laundry-set`.
- [ ] Top-level file invariants `contractVersion`, `appliance`, and `options` are validated on read/write.
- [ ] Unsupported/missing `contractVersion` fails with `OPTIONS_CONTRACT_VERSION_UNSUPPORTED`.
- [ ] Missing/non-canonical `appliance` fails with `OPTIONS_CONTRACT_INVALID`.
- [ ] Canonical-but-mismatched `appliance` fails with `OPTIONS_APPLIANCE_KEY_MISMATCH`.
- [ ] Missing, empty, or non-string persisted `options[].id` values are treated as blocking top-level file failures.
- [ ] Duplicate persisted IDs are treated as blocking top-level file failures.
- [ ] `loadOptions(applianceKey)` returns top-level `ok`, `options`, `warnings`, and `failure`.
- [ ] `saveOption(applianceKey, optionPayload)` returns top-level `ok`, `option`, `warnings`, `validationErrors`, and `failure`.
- [ ] `deleteOption(applianceKey, optionId)` returns top-level `ok`, `deletedOptionId`, `affectedLaundrySetOptionIds`, `repairedLaundrySetOptionIds`, `warnings`, and `failure`.
- [ ] Warning/failure/validation objects all use the same canonical `{ code, message, applianceKey, optionId, dimensionId }` shape.
- [ ] `UNKNOWN_APPLIANCE_KEY` metadata echoes the exact rejected caller input in `applianceKey` when it is a string, otherwise uses `applianceKey: null` for rejected `null`/non-string inputs.
- [ ] Reused schema failure codes from issue #10 are surfaced in this slice with `optionId: null` and `dimensionId: null`.
- [ ] All three APIs reuse the schema dependency codes from issue #10 for schema bootstrap/load/validation failures.
- [ ] The extra dimension-level schema contract needed by this slice is enforced in `src/main/optionStorage.js`, not by broadening `schemaStorage.js` into a wider validator.
- [ ] If a requested or dependent schema passes issue #10 loading but lacks the dimension metadata required by this slice, the API fails with top-level `SCHEMA_CONTRACT_INVALID` for that schema’s `applianceKey`.
- [ ] `requiredDimensionIds` and `dimensions[].required` are treated with a required-consistency rule: malformed fields, unknown IDs, duplicates, or disagreement return top-level `SCHEMA_CONTRACT_INVALID`.
- [ ] Once that consistency check passes, `REQUIRED_DIMENSION_MISSING` and migration requiredness checks use the normalized per-dimension required flag derived from both schema sources.
- [ ] Pointer detection is authoritative only from `dimensions[].type === pointer` on `laundry-set` with `pointerDimensionsAllowed: true`.
- [ ] For this slice, authoritative pointer metadata requires canonical `laundry-set` pointer dimensions `washer` and `dryer` with matching `targetAppliance` values; missing/invalid/mismatched metadata returns top-level `SCHEMA_CONTRACT_INVALID`.
- [ ] `loadOptions()` returns success with empty `options` when the canonical file is missing and the schema is valid.
- [ ] `loadOptions()` returns blocking file failures rather than degrading invalid files to empty lists.
- [ ] `loadOptions()` preserves persisted order and does not rewrite unresolved blocked records.
- [ ] `loadOptions()` safe migrations are in-memory only and are not written back to disk by that call.
- [ ] Migration warning granularity is explicit: multiple affected **Dimensions** on one **Option** produce multiple warnings; record-level branches use `dimensionId: null`.
- [ ] Ordering of `warnings` and `validationErrors` arrays is intentionally non-normative; consumers must not rely on sequence.
- [ ] `loadOptions()` suppresses `OPTION_MIGRATION_APPLIED` for any omitted record that also hits an unsafe migration branch.
- [ ] Extra top-level persisted/submitted **Option** record fields are stripped during load/save normalization rather than rejected or preserved.
- [ ] The migration decision table is implemented exactly for safe add/remove/requiredness/type/pointer branches.
- [ ] `saveOption()` does not apply schema-evolution migration to submitted payloads; it validates against the current schema after only narrow top-level normalization.
- [ ] `saveOption()` never writes partial changes for validation failures, migration blockers, or file/schema failures.
- [ ] `saveOption()` create/update identity rules are explicit and deterministic.
- [ ] `saveOption()` treats only an omitted `id` property as create; present malformed `id` values fail with `UNKNOWN_OPTION_ID` using the required `optionId`/`dimensionId` shaping.
- [ ] `saveOption()` rejects caller-supplied `optionPayload` values that are `null`, arrays, or primitives with call-level `INVALID_EVALUATION_SHAPE`.
- [ ] `saveOption()` validates schema-known **Dimension** IDs, **Evaluation** wrapper shape, required **Dimensions**, required `laundry-set` pointers, and pointer target existence.
- [ ] On `saveOption()`, submitted obsolete **Dimension** keys fail with `UNKNOWN_DIMENSION_ID` rather than being silently dropped as migration.
- [ ] On `saveOption()`, submitted wrapper/type mismatches fail with `INVALID_EVALUATION_SHAPE` rather than `OPTION_MIGRATION_BLOCKED`.
- [ ] `saveOption()` treats missing referenced washer/dryer catalogs as empty for target lookup, but treats invalid referenced files as blocking top-level failures.
- [ ] `saveOption()` defines precedence when payload validation errors coexist with invalid dependent washer/dryer catalog files: the dependent top-level failure wins and `validationErrors` is empty.
- [ ] `saveOption()` also defines precedence when `laundry-set` pointer schema metadata itself is invalid: top-level `SCHEMA_CONTRACT_INVALID` wins over pointer validation errors.
- [ ] `saveOption()` emits no migration warnings in this issue; `warnings` is always `[]`.
- [ ] `saveOption()` and `deleteOption()` define structured top-level failure codes for directory-create, stage-write, replace-failure, and rollback-failure branches.
- [ ] `deleteOption()` maps caller-supplied `optionId` values of `null`, empty string, whitespace-only string, or non-string to `OPTION_NOT_FOUND`, with `failure.optionId: null` for null/non-string inputs and the exact submitted string for empty/whitespace-only inputs.
- [ ] `deleteOption()` explicitly resolves the combined-invalid-input tie-break: `UNKNOWN_APPLIANCE_KEY` wins when both caller inputs are invalid.
- [ ] `deleteOption()` returns top-level option-file failures when the requested source file exists but is invalid.
- [ ] `deleteOption()` precedence is explicit: malformed caller `optionId` wins first; requested source-file top-level failures win before dependent `laundry-set` validation/file failures; dependent `laundry-set` schema/file failures win over missing source file or missing target ID; `OPTION_NOT_FOUND` for missing file/target is only returned after required dependencies validate.
- [ ] `deleteOption()` returns `OPTION_NOT_FOUND` for missing canonical file or missing target ID only after the required delete-path dependencies have cleared top-level schema/file checks.
- [ ] `deleteOption()` defines explicit behavior for `laundry-set` self-delete, missing dependent `laundry-set` file, and invalid dependent `laundry-set` file.
- [ ] `deleteOption()` uses only validated authoritative `laundry-set` pointer metadata for washer/dryer repair planning and fails with top-level `SCHEMA_CONTRACT_INVALID` if that dependent schema metadata is unusable.
- [ ] Successful `deleteOption()` emits no warnings in this slice.
- [ ] Successful `deleteOption()` sets `deletedOptionId` to the exact deleted target ID.
- [ ] Delete-time pointer repair converts affected pointer **Evaluations** to `{ "status": "na" }` with no `value`.
- [ ] `affectedLaundrySetOptionIds` and `repairedLaundrySetOptionIds` are both present on every result.
- [ ] On successful washer/dryer delete with repairs, `repairedLaundrySetOptionIds` equals `affectedLaundrySetOptionIds`.
- [ ] Delete-time repair leaves no partial persisted state behind.
- [ ] Main-process IPC registration and preload exposure remain additive to the issue #10 schema contract.

## 9. Reviewer notes

Reviewers should reject implementations that:

- expose direct file system access or raw IPC primitives to the renderer
- remove or rename existing schema preload methods instead of extending `window.electronAPI`
- silently rewrite or drop whole invalid files on load/save/delete
- treat blocked record migration as a whole-file success with invented values
- implement save-path stale-payload heuristics beyond current-schema validation
- invent new metadata shapes or ad hoc code strings outside the fixed code universe
- collapse invalid dependent referenced files into `POINTER_TARGET_NOT_FOUND`
- invent requiredness or pointer authority rules instead of applying the schema-dependency contract in section 4.3.3
- broaden issue #11 by moving the extra dimension-level schema enforcement into a generalized schema framework
- broaden scope into renderer CRUD UI, delegated pointer resolution, or preset persistence
- leave any observable partial delete/repair state on disk after a failed delete operation

## 10. Intentionally non-normative notes

The following remain intentionally non-normative for this issue as long as the observable contracts above hold:

- exact human-readable `message` text for metadata objects
- array ordering for `warnings` and `validationErrors`
- exact stable ID generation format for newly created **Options**
- internal helper decomposition inside `src/main/optionStorage.js`
- temporary file naming, backup naming, and rollback helper structure used to satisfy the atomic final-state requirement
