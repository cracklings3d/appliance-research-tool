# Canonical Plan — Issue #5: Implement schema-driven Option CRUD forms with validation

- Issue: [#5](https://github.com/cracklings3d/appliance-research-tool/issues/5)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #5

## 1. Clarified objective

Implement the renderer-side CRUD slice for **Options** so users can add, edit, and delete **Washer**, **Dryer**, and **Laundry Set** **Options** through schema-driven forms backed by the existing schema and **Option** storage IPC contracts.

Issue #5 still depends conceptually on issue #2's renderer-shell/read-only-list foundation, but this worktree does not contain that completed shell. In this branch, issue #5 may therefore establish only the narrow host subset needed to enter CRUD flows, see settled rows for the active **Appliance**, and observe CRUD outcomes. It must not absorb the broader read-only shell/list responsibilities already assigned to issue #2.

This slice must:

- derive editable form fields from the active local **Appliance** schema instead of hand-authored per-**Appliance** forms
- use the existing preload contract only (`listSchemas`, `loadSchema`, `loadOptions`, `saveOption`, `deleteOption`)
- preserve explicit Save/Cancel form behavior rather than immediate persistence
- surface field-level validation feedback returned by `saveOption(...)`
- support delete confirmation text that explains downstream **Laundry Set** impact before persistence

## 2. Scope boundaries

### In scope

- renderer-only CRUD flows for `washer`, `dryer`, and `laundry-set`
- minimal issue-#2 host subset needed to make the CRUD slice usable in the current worktree
- schema-derived direct-field form generation for `boolean`, `enum`, `numeric`, `string`, and direct `pointer` **Dimensions**
- explicit create, edit, save, cancel, and delete-confirmation flows
- renderer-side derivation of delete impact messaging for referenced washer/dryer **Options** using existing `loadOptions('laundry-set')` data
- renderer-side loading of washer/dryer catalogs needed to populate **Laundry Set** pointer selectors
- focused tests for pure renderer helpers introduced to keep the slice maintainable

### Allowed issue-#2 host subset for this branch

Because the checked-out worktree still has only a placeholder renderer, this branch may add just enough renderer shell/list behavior to make CRUD operable:

- **Appliance** switching among `washer`, `dryer`, and `laundry-set`
- active-view loading, empty, and error states required to support CRUD entry and post-mutation refresh
- a settled list region that shows existing **Options** for the active **Appliance** so the user can choose create/edit/delete targets
- row-level affordances for create, edit, and delete entry points

### Prohibited broader issue-#2 shell/list work

This branch must not broaden into general renderer-shell completion beyond CRUD needs. Specifically do not add or expand:

- richer read-only list-view polish whose only purpose is browsing rather than CRUD
- extra list columns or derived display behavior beyond what CRUD needs to identify rows
- user-controlled ordering, sorting UI, pagination, or column customization
- pointer-resolution display, delegated-field presentation, shortened-id display, or incomplete-state UX
- reusable shell architecture meant to finish all of issue #2 independently of CRUD

### Out of scope

- new main-process or preload APIs
- schema editing or schema persistence changes
- filtering (#7)
- **Comparison** UI or preset workflows (#6, #12)
- delegated `washer.*` / `dryer.*` value display or incomplete-state UX (#4)
- broad recreation of issue #2 beyond the minimum host shell needed for this CRUD slice
- packaged-build, storage-layer, or schema-contract refactors

## 3. Repository facts that constrain the plan

- `src/preload/index.js` already exposes all required persistence methods for this slice; issue #5 should consume them and should not widen that bridge.
- `src/main/optionStorage.js` already defines the authoritative save/delete result envelopes:
  - `saveOption(applianceKey, optionPayload)` returns `ok`, `option`, `warnings`, `validationErrors`, and `failure`
  - `deleteOption(applianceKey, optionId)` returns `ok`, `deletedOptionId`, `affectedLaundrySetOptionIds`, `repairedLaundrySetOptionIds`, `warnings`, and `failure`
- The current renderer worktree is still minimal (`src/renderer/src/App.vue` is placeholder-only), so this issue cannot integrate into an existing shell/list module. It may establish only the minimum issue-#2 host subset needed for issue #5 itself.
- Shipped schemas confirm the supported direct editable types for this slice:
  - `washer` and `dryer` use direct `string`, `numeric`, `enum`, and `boolean` **Dimensions**
  - `laundry-set` uses direct `string`, `numeric`, and direct `pointer` **Dimensions** (`washer`, `dryer`)
- Issue #5 remains bound to direct schema **Dimensions** only. Any local schema entry whose `id` contains a delegated dotted path like `washer.capacity` or `dryer.noiseLevel` must be excluded from editable controls.

## 4. Assumptions

- Because the current worktree does not include a completed read-only shell from issue #2, implementation may add the minimum **Appliance** switcher, settled **Option** list region, CRUD entry affordances, and active-view loading/empty/error states required to satisfy issue #5 in renderer code only.
- Pointer selector labels may be renderer-derived from referenced **Option** data by preferring known `brand` + `model` **Evaluations** and falling back to the full internal **Option** id when a better human label is unavailable.
- For non-pointer **Dimensions**, the form should support both `known` and `na` **Evaluation** states so the renderer can submit the storage contract already accepted by issue #11.

## 5. Required implementation shape

### 5.1 Renderer host boundary

Keep all production changes under `src/renderer/src/`.

Issue-#2 boundary rule for this implementation:

- allowed: the smallest renderer shell/list subset required to select an **Appliance**, surface existing rows, enter CRUD flows, and observe refresh/error outcomes after save/delete
- not allowed: standalone completion of issue #2 read-only browsing behavior that is not directly exercised by CRUD entry or CRUD result visibility

Recommended decomposition:

- `App.vue` as the narrow composition root for the issue-#5 CRUD screen
- new components under `src/renderer/src/components/` for focused UI pieces such as:
  - **Appliance** navigation
  - **Option** list/table
  - schema-driven form fields / editor shell
  - delete confirmation dialog
- new composables or pure helpers under `src/renderer/src/composables/` or sibling renderer modules for:
  - schema-to-form-field derivation
  - form draft normalization / payload assembly
  - delete-impact analysis
  - validation error grouping

Do not move storage or IPC logic into the renderer beyond calling `window.electronAPI`.

### 5.2 Data-loading model

The CRUD screen should use this loading model:

1. Load available **Appliances** through `window.electronAPI.listSchemas()` for navigation labels.
2. For the active `applianceKey`, load:
   - `loadSchema(applianceKey)`
   - `loadOptions(applianceKey)`
3. When creating or editing a `laundry-set` **Option**, additionally load:
   - `loadOptions('washer')`
   - `loadOptions('dryer')`
   to populate pointer selectors.
4. When preparing delete confirmation for a `washer` or `dryer`, load or reuse `loadOptions('laundry-set')` to derive the affected **Laundry Set Option** count before confirmation text is shown.

All expected failures from these calls must be handled as renderer state, not as thrown business exceptions.

### 5.3 Schema-derived editable field contract

Form generation must derive editable fields from the active schema with these rules:

- iterate in schema `dimensions` order
- include only direct **Dimensions** for the active **Appliance**
- exclude any `dimension.id` containing `.` so delegated paths such as `washer.capacity` / `dryer.noiseLevel` never render as editable inputs
- include direct pointer **Dimensions** like `washer` and `dryer`
- preserve schema `label`, `required`, `type`, `allowedValues`, and `unit` metadata where relevant to the control

No separate hand-authored field map per **Appliance** is allowed.

### 5.4 Draft state and control mapping

The renderer should maintain a form draft separate from persisted **Option** data.

Recommended per-field draft shape:

- `status: 'known' | 'na'`
- raw input state for the field value while editing

Control expectations by direct **Dimension** type:

- `string`: text input
- `numeric`: numeric text/input control that keeps draft text local until submit normalization
- `enum`: select control using schema `allowedValues`
- `boolean`: explicit true/false control
- `pointer`: select control whose choices come from the referenced **Appliance** catalog

Behavior rules:

- for non-pointer **Dimensions**, users can mark the field as `N/A`; when selected, the value input is disabled and submission uses `{ status: 'na' }`
- for `laundry-set` pointer fields `washer` and `dryer`, the UI must guide the user toward selecting an existing target **Option**; final save cannot rely on `na` because issue #11 blocks it with `POINTER_TARGET_REQUIRED`
- editing existing records must prefill the draft from persisted `evaluations`
- create flow starts from a schema-derived empty draft, not by mutating a live persisted row

### 5.5 Save and cancel flow

The CRUD slice must use explicit edit sessions.

Required behavior:

- entering create/edit mode copies data into an isolated draft
- while create/edit mode is open, changes remain draft-only and do not mutate the settled list rows shown outside the editor
- Cancel discards the draft, clears validation state, closes or resets the edit session as designed, and leaves persisted list data unchanged
- Save assembles a canonical `optionPayload` from the draft and calls `saveOption(applianceKey, optionPayload)`
- create mode omits `id`; edit mode includes the existing `id`
- after successful save, reload the active **Option** list from storage and exit edit mode
- the list refresh happens after save success and before the UI is treated as settled again; stale pre-save rows must not be presented as freshly persisted state
- failed save with top-level `failure` shows a call-level error state for the editor and does not mutate the settled list
- failed save with `validationErrors` keeps the editor open and maps errors to field-level feedback by `dimensionId`

Validation feedback requirements:

- `UNKNOWN_DIMENSION_ID`, `INVALID_EVALUATION_SHAPE`, `REQUIRED_DIMENSION_MISSING`, `POINTER_TARGET_REQUIRED`, and `POINTER_TARGET_NOT_FOUND` must render next to the owning field when `dimensionId` is present
- call-level validation/failure entries with `dimensionId: null` remain visible in a form-level error region
- save attempts must never partially update the visible settled list before a successful reload

### 5.6 Delete confirmation and execution flow

Delete must remain explicit and pre-confirmed.

Required behavior:

- selecting delete opens a confirmation dialog before calling `deleteOption(...)`
- delete-impact messaging for `washer` / `dryer` must be derived before the destructive call, using current or freshly loaded `laundry-set` data while the dialog is still in the pre-confirmation state
- for `washer` and `dryer`, confirmation text must be derived before persistence by scanning current `laundry-set` **Options** for references to the target id
- if references exist, the text must explain that affected **Laundry Set Options** remain, the corresponding pointer reference will be cleared, and those sets become incomplete
- if no references exist, washer/dryer confirmation can use standard delete wording without downstream-impact text
- for `laundry-set`, confirmation text must state that only the selected **Laundry Set Option** is removed and no washer/dryer **Options** are deleted or modified
- after a successful delete, reload the active **Option** list; if the deleted type was `washer` or `dryer`, any cached delete-impact data based on `laundry-set` options must also be refreshed or invalidated
- the active list view must not remove the row optimistically before confirmation and delete success; visible removal comes from the post-delete refresh

Do not add a new preview-delete IPC method for this slice.

### 5.7 Minimal view states required for this slice

Because the current renderer is placeholder-only, issue #5 must establish only the minimal view states needed to support CRUD:

- **Appliance** selection state
- active list state for existing **Options**
- create/edit session state
- editor loading/error state for auxiliary pointer catalogs when needed
- delete confirmation state
- empty state when the active **Appliance** has no **Options**

This slice does not need to recreate richer read-only list behaviors outside what CRUD needs.

Pointer-catalog state requirements for `laundry-set` edit/create sessions:

- the editor must distinguish auxiliary catalog loading from active-list loading so pointer-selector state is understandable to the user
- if washer/dryer catalogs are still loading, pointer controls and Save readiness must reflect that unresolved dependency explicitly
- if either catalog fails to load, the editor must show an explicit auxiliary-data error state and must not pretend pointer selection is ready
- retry/re-entry behavior may be simple, but post-failure state must remain isolated to the editor rather than corrupting settled list state

## 6. Machine-readable change scope

```json
{
  "allowed_paths": [
    ".opencode/plans/issue-5.md",
    "src/renderer/src/App.vue",
    "src/renderer/src/assets/main.css",
    "src/renderer/src/components/**",
    "src/renderer/src/composables/**",
    "src/renderer/src/*.js",
    "test/**"
  ],
  "optional_new_paths": [
    "src/renderer/src/components/OptionCrudShell.vue",
    "src/renderer/src/components/OptionListView.vue",
    "src/renderer/src/components/SchemaDrivenOptionForm.vue",
    "src/renderer/src/components/DeleteOptionDialog.vue",
    "src/renderer/src/composables/useOptionCrud.js",
    "src/renderer/src/composables/useSchemaDrivenOptionForm.js",
    "src/renderer/src/optionFormSchema.js",
    "test/rendererOptionCrud.test.js"
  ],
  "forbidden_paths": [
    "src/main/**",
    "src/preload/**",
    "schemas/**",
    "electron-builder.json",
    "package.json",
    ".opencode/plans/issue-10.md",
    ".opencode/plans/issue-11.md",
    ".opencode/plans/issue-12.md"
  ],
  "likely_touched_paths": [
    "src/renderer/src/App.vue",
    "src/renderer/src/assets/main.css",
    "src/renderer/src/components/**",
    "src/renderer/src/composables/**",
    "test/**"
  ],
  "shared_hotspots": [
    "src/renderer/src/App.vue",
    "src/renderer/src/assets/main.css"
  ],
  "dependencies": [
    {
      "issue": 2,
      "reason": "Renderer shell/read-only list foundation; in this worktree issue #5 may recreate only the minimal host subset needed for CRUD entry, active-view states, and post-mutation visibility. It must not absorb broader read-only shell/list work."
    },
    {
      "issue": 10,
      "reason": "Active local schema discovery and load via listSchemas/loadSchema."
    },
    {
      "issue": 11,
      "reason": "Option load/save/delete contracts and returned validation errors."
    }
  ],
  "non_goals": [
    "Filtering controls or filtered-result behavior.",
    "Comparison selection, presets, or side-by-side comparison UI.",
    "Delegated washer/dryer value display or incomplete Laundry Set presentation.",
    "Any new IPC/storage/schema API for previewing deletes or generating forms.",
    "Broad renderer-shell work unrelated to getting CRUD flows usable in the current worktree."
  ]
}
```

## 7. Planned file touch list for implementation

### Expected files to change

- `.opencode/plans/issue-5.md` (this plan)
- `src/renderer/src/App.vue`
- `src/renderer/src/assets/main.css`
- one or more new renderer components under `src/renderer/src/components/`
- one or more new renderer helpers/composables under `src/renderer/src/composables/` or sibling renderer modules
- focused tests under `test/` for pure renderer helpers introduced by this slice

### Files that should remain untouched for this issue

- `src/main/**`
- `src/preload/**`
- `schemas/**`
- persistence plans for other issues

## 8. Implementation sequence

1. Replace the placeholder `App.vue` with a minimal CRUD host that can switch among supported **Appliances**.
2. Extract schema-driven field derivation into a pure renderer helper so editable-field filtering and ordering stay deterministic.
3. Build the isolated create/edit draft workflow and payload assembly for direct schema **Dimensions**.
4. Add pointer-catalog loading for `laundry-set` forms and map pointer choices to existing washer/dryer **Option** ids.
5. Wire `saveOption(...)` and map returned `validationErrors` into field-level and form-level feedback.
6. Add delete confirmation flows with renderer-derived downstream-impact messaging for referenced washer/dryer **Options**.
7. Add focused tests for helper logic, especially delegated-field exclusion, payload shaping, validation grouping, and delete-impact analysis.
8. Verify the implementation against section 10 before closing the issue.

## 9. Focused test plan

Use the existing `node:test` approach and keep tests centered on pure renderer helpers rather than introducing a broad browser/component test harness.

Required coverage:

1. **Schema field derivation**
   - direct **Dimensions** are returned in schema order
   - delegated dotted ids are excluded
   - direct pointer **Dimensions** are retained
2. **Draft-to-payload shaping**
    - create payload omits `id`
    - edit payload preserves `id`
    - `known` and `na` states map to the issue-#11 **Evaluation** contract correctly
3. **Save/Cancel session isolation**
   - entering edit/create produces an isolated draft rather than mutating the settled row snapshot
   - Cancel clears draft/validation session state without changing the last settled list snapshot
   - save-success state transition requires a reload before the settled list is replaced
4. **Validation error grouping**
   - field-level errors are grouped by `dimensionId`
   - call-level errors remain separate when `dimensionId` is `null`
5. **Delete impact analysis**
   - washer/dryer impact detection finds referencing **Laundry Set Options** by pointer **Evaluation**
   - non-matching or `na` pointer states do not count as affected
6. **Pointer choice label derivation**
   - known `brand` + `model` is preferred
   - fallback to **Option** id remains deterministic when those fields are unavailable
7. **User-visible workflow verification (manual or targeted UI checks)**
   - Save/Cancel isolation is observable in the rendered CRUD flow and the visible list remains unchanged until a successful save refresh completes
   - delete confirmation text is prepared before the destructive action and does not appear only after deletion has already occurred
   - after successful save, the active **Option** list is refreshed from storage before the editor is dismissed as settled
   - after successful delete, the active **Option** list refresh removes the deleted row from settled state without optimistic disappearance beforehand
   - `laundry-set` create/edit flows cover washer/dryer pointer-catalog loading and explicit failure states

## 10. Acceptance checklist mapped to issue #5

- [ ] Users can add, edit, and delete `washer`, `dryer`, and `laundry-set` **Options** from the renderer.
- [ ] Editable direct **Dimensions** are derived from the active local schema, not from hand-authored per-**Appliance** forms.
- [ ] Supported direct **Dimension** types map to usable form controls for `boolean`, `enum`, `numeric`, `string`, and `pointer`.
- [ ] Delegated dotted paths such as `washer.*` and `dryer.*` are never rendered as editable inputs.
- [ ] The form uses explicit Save/Cancel flows and does not persist while the user is still editing.
- [ ] Cancel abandons unsaved changes and leaves persisted data unchanged.
- [ ] Save calls the existing `saveOption(...)` contract and only updates settled list state after success plus post-save reload.
- [ ] Field-level validation feedback is surfaced from returned `validationErrors`.
- [ ] Saving a **Laundry Set Option** requires valid existing `washer` and `dryer` targets and surfaces returned pointer validation errors when invalid.
- [ ] Deleting any **Option** requires explicit confirmation before persistence.
- [ ] Washer/dryer delete confirmation text explains downstream incomplete **Laundry Set** impact when references exist, and that messaging is available before the delete call executes.
- [ ] Laundry-set delete confirmation text explains that only the selected **Laundry Set Option** is removed.
- [ ] Post-delete settled list state comes from a refresh after delete success rather than optimistic local row removal.
- [ ] `Laundry Set` editor states clearly handle washer/dryer pointer-catalog loading and auxiliary-data failures.
- [ ] Issue #5 stays inside renderer scope and does not add new storage/preload APIs.

## 11. Reviewer notes

Reviewers should reject implementations that:

- hard-code separate form definitions per **Appliance** instead of deriving fields from schema metadata
- render delegated dotted-path fields as editable inputs
- bypass `window.electronAPI` or change preload/main-process APIs for convenience
- persist edits immediately on field change instead of using Save/Cancel
- show downstream delete-impact messaging only after `deleteOption(...)` has already executed
- broaden scope into filtering, comparison, schema editing, or delegated-field presentation
- use issue #5 as a vehicle to complete general issue-#2 shell/list work beyond the minimal CRUD host subset
- add a heavy renderer test framework when pure helper tests are sufficient for this slice

## 12. Open risk to watch

- Because the current worktree still has a placeholder renderer, the main scope risk is accidental reimplementation of issue #2. Keep the UI host minimal: enough **Appliance** navigation, active-view loading/empty/error states, list visibility, and editor state to make CRUD usable, but no extra read-only feature work beyond that.
