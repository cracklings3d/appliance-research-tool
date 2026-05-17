# Canonical Plan — Issue #6: Build side-by-side comparison with default dimensions and saved presets

- Issue: [#6](https://github.com/cracklings3d/appliance-research-tool/issues/6)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #6

## 1. Clarified objective

Implement the renderer-side **Comparison** workflow for one active **Appliance** so users can choose multiple **Options** from the current list surface, compare them side-by-side using schema-default **Dimensions**, adjust the compared **Dimensions** for the current view, and load/save/delete named comparison presets through the existing renderer-facing preset APIs from issue #12.

This slice must:

- stay entirely in the renderer layer
- consume the existing schema, **Option**, and preset APIs already exposed on `window.electronAPI`
- start each active-**Appliance** comparison view from that schema's `defaultComparisonDimensionIds`
- show a visible renderer warning when an applied preset includes missing **Dimensions**, while using only the preset's returned `effectiveDimensionKeys`
- keep **Comparison** scoped to one active **Appliance** with no scoring, winner logic, cross-**Appliance** mixing, or new persistence contracts

## 2. Scope boundaries

### In scope

- renderer-side multi-**Option** selection interaction within the active **Appliance** list/view
- renderer state for compared **Option** IDs, compared **Dimension** keys, preset list state, and comparison warnings
- side-by-side **Comparison** presentation for the selected **Options** and selected **Dimensions**
- schema-default **Dimension** initialization from `defaultComparisonDimensionIds`
- add/remove compared **Dimensions** for the current view only
- preset load/save/delete UI behavior using the issue-#12 preload contract exactly as-is
- visible warning presentation for applied-preset missing-**Dimension** metadata
- horizontal overflow behavior for wide comparisons so all selected columns still render
- focused renderer tests for comparison-state derivation and preset-warning consumption

### Out of scope

- any Electron main-process, preload, storage-file, or IPC contract changes
- schema bootstrap/load changes from #10
- **Option** persistence, migration, or delete-repair changes from #11
- preset persistence-contract or warning-shape changes from #12
- broad renderer-shell redesign beyond comparison-specific integration points
- overall scoring, ranking, or winner logic
- cross-**Appliance** comparison
- delegated `laundry-set` comparison such as `washer.capacity` or `dryer.noiseLevel`
- incomplete `laundry-set` grey-out/warning semantics owned by #4

## 3. Repository facts that constrain the plan

- `CONTEXT.md` defines the required vocabulary and comparison rules: **Comparison** is side-by-side, scoped to one active **Appliance**, starts from schema defaults, and supports named presets stored as user preferences.
- `AGENTS.md` requires renderer business logic to live in composables/stores and forbids bypassing `window.electronAPI`.
- ADR `docs/adr/0001-electron-vue-vite-stack.md` keeps UI work in the Vue renderer and storage/contracts in Electron main/preload.
- `src/preload/index.js` already exposes the renderer APIs this issue must consume: `loadSchema`, `loadOptions`, `loadPresets`, `savePreset`, and `deletePreset`.
- `src/main/index.js` already wires preset IPC handlers; issue #6 must not redesign or duplicate those flows.
- `src/main/presetStorage.js` defines the result-envelope behavior issue #6 must consume: `savePreset()` returns either a saved preset, validation errors, or a top-level failure; `deletePreset()` returns either `deletedPresetId` or a top-level failure; neither mutation API returns warning records on success.
- `schemas/*.schema.json` already provide `defaultComparisonDimensionIds`; this issue consumes them and does not rewrite schema files.
- `schemas/laundry-set.schema.json` currently exposes only direct keys such as `brand`, `model`, `bundlePrice`, `discountAmount`, `washer`, and `dryer`, while `CONTEXT.md` reserves delegated laundry-set keys for namespaced paths such as `washer.capacity` and `dryer.noiseLevel` owned by issue #4.
- The current checked-in renderer is still minimal (`src/renderer/src/App.vue`, `src/renderer/src/main.js`) and contains no comparison/list implementation yet; issue #6 must therefore integrate with the renderer shell delivered by prerequisite issue #2 instead of redefining the whole shell contract here.
- The repo currently has `node:test` coverage for main/preload slices, but no established Vue component test harness; this plan therefore prefers pure renderer-state helpers/composables that can be tested without adding a broad new tooling stack.

## 4. Assumptions carried by this plan

- Prerequisite issues #2, #10, #11, and #12 are available before issue #6 implementation is considered complete; if the working branch is missing those prerequisites, the fix is to bring in the prerequisite work rather than widen issue #6.
- Comparison column order follows the current active **Option** list order filtered to the selected IDs; this issue does not introduce a separate persisted comparison-column ordering contract.
- Preset names are not required to be unique in this issue; preset identity remains the persisted preset `id` from issue #12.
- Until issue #4 exists, any directly stored `laundry-set` pointer **Dimensions** that are compared render only the currently available stored pointer value already loaded into the renderer; no delegated expansion, target-label lookup contract, or incomplete-entry styling is introduced here.
- Until issue #4 exists, any `laundry-set` **Dimension** key containing `.` is treated as delegated and therefore excluded from issue-#6 comparison defaults, add-dimension choices, applied preset `effectiveDimensionKeys`, and saved preset payloads.

## 5. Required implementation shape

### 5.1 Renderer architecture boundary

Keep comparison logic in the renderer. Do not add new preload or main-process APIs.

Recommended split:

- existing shell integration file under `src/renderer/src/App.vue` or the current issue-#2 shell equivalent
- one or more comparison-focused Vue components under `src/renderer/src/components/`
- one comparison-focused composable or plain renderer-state helper under `src/renderer/src/composables/`

The composable/helper should own selection, dimension, preset, and warning state so UI components remain mostly presentational.

### 5.2 Renderer data dependencies

Issue #6 may consume only the existing renderer-facing contracts already exposed on `window.electronAPI`:

- `loadSchema(applianceKey)`
- `loadOptions(applianceKey)`
- `loadPresets(applianceKey)`
- `savePreset(applianceKey, presetPayload)`
- `deletePreset(applianceKey, presetId)`

This issue must not add renderer-side shadow persistence or alternate schema/preset loading paths.

### 5.3 Comparison state model

For the active **Appliance**, the renderer must maintain at least:

- `activeApplianceKey`
- loaded schema and schema-derived direct **Dimension** metadata
- loaded active-**Appliance** **Options**
- `selectedOptionIds`
- current-view `comparedDimensionKeys`
- loaded preset summaries/records for the active **Appliance**
- `appliedPresetId` for the currently applied saved preset, if any
- current comparison warning state for the actively applied preset, if any
- user-visible preset action error state for save/delete validation or blocking failures, kept distinct from non-blocking preset warning state

Derived rules:

- available compared **Dimensions** come from the active schema's `dimensions[]`, filtered through the issue-#6 eligibility rules below
- initial `comparedDimensionKeys` come from `defaultComparisonDimensionIds`, filtered to eligible schema **Dimension** IDs and deduplicated while preserving schema order
- changing the active **Appliance** resets `selectedOptionIds`, resets `comparedDimensionKeys` to the new schema defaults, clears `appliedPresetId`, clears any active preset-warning banner, clears any preset action error, and reloads that appliance's presets
- when the active **Option** list refreshes, `selectedOptionIds` must be pruned to IDs that still exist in the loaded list

This issue must not persist the current ad hoc `selectedOptionIds` or unsaved `comparedDimensionKeys` outside the current renderer session.

### 5.4 Multi-option selection behavior

The comparison-selection interaction belongs in the active **Option** list/read-only browsing surface introduced by #2.

Normative behavior:

- users can toggle any number of **Options** from the currently active **Appliance** into or out of the comparison set
- selection controls must be visible from the active **Option** list surface; do not require a separate compare-staging screen
- no **Option** is auto-selected on appliance load
- selected IDs are scoped to the current active **Appliance** only
- if zero **Options** are selected, the comparison region shows an empty state instead of blank columns or implicit placeholder **Options**
- rendered comparison-column order follows the current active **Option** list order filtered to the selected IDs

### 5.5 Compared-dimension behavior

Normative behavior for the current comparison view:

- define `eligibleComparisonDimensionKeys` from the active schema before any default/preset/UI derivation:
  - for `washer` and `dryer`, every schema `dimensions[].id` is eligible
  - for `laundry-set`, only direct keys are eligible; any key containing `.` (for example `washer.capacity` or `dryer.noiseLevel`) is treated as delegated and excluded until issue #4
- on first load for an active **Appliance**, use that schema's `defaultComparisonDimensionIds`
- users can add a currently unselected schema **Dimension** to the comparison view without mutating schema files or presets
- users can remove any currently compared **Dimension** from the current view
- adding a **Dimension** appends it to the end of the current `comparedDimensionKeys` order
- removing a **Dimension** deletes only that key from the current view state
- the add-dimension control must list only currently unselected eligible keys; excluded delegated `laundry-set` keys are never shown in this issue's UI
- loading a preset replaces the current `comparedDimensionKeys` with the preset's returned `effectiveDimensionKeys`, filtered again to eligible keys, in remaining order
- successful preset save uses the current `comparedDimensionKeys` order as the saved `dimensionKeys` payload; because current view state is already constrained to eligible keys, delegated `laundry-set` keys are never submitted from issue #6

This issue does not introduce drag-reordering of compared **Dimensions**.

### 5.6 Preset workflow behavior

Preset behavior must consume issue-#12 renderer-facing APIs exactly as implemented.

Normative behavior:

- load the preset list for the active **Appliance** from `loadPresets(applianceKey)`
- present named preset actions for save, apply/load, and delete in the comparison UI
- saving a preset requires a renderer-provided non-empty name entry flow; the exact control may be inline or modal, but it must stay in renderer scope
- applying a preset replaces the current compared **Dimensions** with that preset's `effectiveDimensionKeys`
- initial preset-list refresh points are limited to active-**Appliance** load/change and explicit user retry after a blocking preset-list load failure
- successful `savePreset(applianceKey, presetPayload)` must upsert the returned `preset` into local preset state without a mandatory follow-up `loadPresets()` call, because the save result is already canonical for this issue's UI needs
- successful `deletePreset(applianceKey, presetId)` must remove the returned `deletedPresetId` from local preset state without a mandatory follow-up `loadPresets()` call
- save/delete failure paths must not trigger an automatic preset-list refresh, because issue #12 defines those branches as no-op persistence outcomes for renderer purposes
- after a successful save or delete, preset UI state must stay consistent with the canonical mutation result from issue #12 rather than stale pre-mutation local-only records

Save/delete validation and failure handling:

- `savePreset()` validation errors must be shown in the preset save UI as user-correctable errors near the save interaction; do not collapse them into the applied-preset warning banner
- top-level `savePreset()` or `deletePreset()` failures must surface a clear non-blocking preset action error in the preset-controls area; keep this visually distinct from blocking list/schema load failures and from `PRESET_DIMENSION_MISSING` warnings
- if `savePreset()` returns validation errors or a top-level failure, leave `selectedOptionIds`, `comparedDimensionKeys`, `appliedPresetId`, the active preset warning banner, and the loaded preset list unchanged
- if `savePreset()` fails, preserve the user's in-progress preset name entry so they can correct and retry
- if `deletePreset()` fails, leave `selectedOptionIds`, `comparedDimensionKeys`, `appliedPresetId`, the active preset warning banner, and the loaded preset list unchanged
- successful save/delete clears any stale preset action error state

Preset-warning handling:

- issue #12 may return `PRESET_DIMENSION_MISSING` warnings from `loadPresets()` for stored preset records
- issue #6 must retain those warnings in renderer state per preset record
- do not show warnings globally for every stored preset on initial preset-list load
- when the user applies a preset that carries missing-**Dimension** warnings, show a clear visible comparison warning tied to the applied preset and compare using only that preset's `effectiveDimensionKeys`
- if the applied preset has no missing-**Dimension** warnings, clear any prior applied-preset warning banner
- do not fabricate `PRESET_DIMENSION_MISSING` warnings for delegated `laundry-set` keys excluded by issue-#6 scope; they are filtered as deferred issue-#4 behavior, not reported as missing-schema keys

### 5.7 Comparison rendering rules

The comparison region must render one column per selected **Option** and one row per currently compared **Dimension**.

Normative rendering rules:

- every selected **Option** renders as its own comparison column; do not merge, truncate away, or silently hide columns
- the comparison region must allow horizontal overflow when selected columns exceed viewport width
- row labels come from schema **Dimension** labels when available
- known **Evaluations** render the currently loaded value for that **Option** and **Dimension**
- `status: "na"` renders as a visible N/A state, not as an empty string
- missing evaluation wrappers that are absent from loaded option data should render as empty/placeholder display only if that absence already exists in the loaded data; do not invent synthetic values
- for `washer` and `dryer` appliance comparisons, use the directly loaded current **Option** data
- for `laundry-set`, compare only directly available **Dimensions** already present in the loaded record; do not introduce delegated-field expansion or incomplete-entry grey-out behavior from #4

### 5.8 Failure and loading presentation boundaries

This issue is renderer-side, so it must respect the result envelopes returned by existing APIs instead of redefining them.

Required behavior:

- if schema, option, or preset loading returns blocking failures, surface a clear renderer-visible failure state within the comparison/list area instead of crashing the view
- keep preset missing-**Dimension** warnings visually distinct from blocking load failures
- keep preset save/delete validation and mutation failures visually distinct from both applied-preset missing-**Dimension** warnings and top-level load failures
- do not convert non-blocking preset warnings into blocking renderer failures
- do not clear successful comparison state merely because a save/delete action failed
- do not swallow top-level preset/schema/**Option** failures silently

Exact copy text is non-normative, but the visible distinction between blocking failures and non-blocking preset warnings is required.

## 6. Planned file touch list for implementation

### Expected files to change

- `.opencode/plans/issue-6.md` (this plan)
- `src/renderer/src/App.vue`
- comparison-focused Vue files under `src/renderer/src/components/`
- comparison-focused state helpers/composables under `src/renderer/src/composables/`
- focused renderer tests under `test/` for comparison-state helpers/composables

### Files that should remain untouched for this issue

- `src/main/**`
- `src/preload/**`
- `schemas/**`
- `electron-builder.json`
- `package.json` unless an already-approved narrow renderer test hook is strictly required during implementation review
- `.opencode/plans/issue-10.md`
- `.opencode/plans/issue-11.md`
- `.opencode/plans/issue-12.md`

## 7. Machine-readable change scope

```json
{
  "allowed_paths": [
    ".opencode/plans/issue-6.md",
    "src/renderer/src/App.vue",
    "src/renderer/src/components/**/*.vue",
    "src/renderer/src/composables/**/*.js",
    "test/**/*.js"
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
  "shared_hotspots": [
    "src/renderer/src/App.vue",
    "src/preload/index.js",
    "test/**/*.js"
  ]
}
```

## 8. Implementation sequence

1. Integrate comparison state into the existing active-**Appliance** renderer shell from #2 instead of creating a parallel shell.
2. Add active-**Appliance** schema/**Option**/preset loading orchestration in renderer state using the existing `window.electronAPI` methods only.
3. Add multi-**Option** selection controls to the current **Option** list surface.
4. Add comparison-view state derivation for selected **Option** columns and current `comparedDimensionKeys`.
5. Add dimension add/remove controls for the current comparison view.
6. Add preset save/apply/delete controls wired to issue-#12 APIs, including applied-preset warning handling.
7. Add comparison rendering with horizontal overflow and visible N/A presentation.
8. Add focused renderer tests for state derivation and warning application, then verify the acceptance checklist below.

## 9. Focused test plan

Keep tests narrow and renderer-focused. Prefer plain-state helpers/composables that can be exercised with the existing `node:test` setup over introducing a broad end-to-end framework in this issue.

Required automated coverage:

1. **Schema default-dimension derivation**
   - filters missing keys from `defaultComparisonDimensionIds`
   - deduplicates while preserving order
2. **Selection behavior is appliance-scoped**
   - no implicit auto-selection
   - changing active **Appliance** clears selected IDs and resets compared **Dimensions**
   - refreshing the loaded **Option** list prunes missing selected IDs
3. **Comparison-column ordering**
   - selected columns follow current loaded **Option** list order rather than selection timestamp order
4. **Current-view dimension changes**
    - add appends a new **Dimension** at the end
    - remove deletes only the requested **Dimension**
    - load preset replaces current compared **Dimensions** with eligible `effectiveDimensionKeys`
5. **Preset warning application**
    - warnings returned for non-applied presets are stored but not shown as active comparison warnings
    - applying a preset with `PRESET_DIMENSION_MISSING` warnings surfaces a visible active warning state and uses only `effectiveDimensionKeys`
    - applying a clean preset clears stale warning state
6. **Preset save/delete mutation handling**
   - failed `savePreset()` validation leaves compared **Dimensions**, selected **Options**, loaded preset list, and applied warning state unchanged while exposing user-correctable preset save errors
   - top-level failed `savePreset()` leaves comparison state and preset list unchanged while exposing a non-blocking preset action error
   - failed `deletePreset()` leaves comparison state and preset list unchanged while exposing a non-blocking preset action error
   - successful save locally upserts the returned preset without requiring immediate `loadPresets()`
   - successful delete locally removes the deleted preset without requiring immediate `loadPresets()`
7. **Laundry-set delegated-dimension exclusion**
   - schema defaults ignore `laundry-set` keys containing `.`
   - add-dimension choices exclude `laundry-set` keys containing `.`
   - applied preset `effectiveDimensionKeys` are filtered to exclude `laundry-set` keys containing `.` even if they appear in saved data or future schema variants
8. **Comparison cell display derivation**
    - known values render the loaded value
    - `status: "na"` renders as visible N/A state
    - direct laundry-set pointer values remain direct values and do not trigger delegated expansion

Manual verification required during review if no renderer component harness exists at implementation time:

- selected comparison columns remain visible through horizontal scrolling on narrow widths
- selection controls are reachable from the active **Option** list surface
- comparison empty state is shown when no **Options** are selected
- preset save/apply/delete interactions remain consistent with persisted data returned from issue #12

## 10. Acceptance checklist mapped to issue #6

- [ ] **Comparison** remains scoped to one active **Appliance** and does not compare **Options** across different **Appliances**.
- [ ] No scoring, ranking, or winner logic is introduced.
- [ ] Initial comparison **Dimensions** for an active **Appliance** come from that schema's `defaultComparisonDimensionIds`.
- [ ] Users can select multiple **Options** for **Comparison** from the active **Option** list surface introduced by #2.
- [ ] Users can add and remove compared **Dimensions** for the current view without mutating schema files or persistence contracts.
- [ ] Users can load, save, and delete named presets through the existing issue-#12 renderer-facing behavior.
- [ ] Applying a preset with missing **Dimensions** shows a visible warning and uses only the preset's `effectiveDimensionKeys`.
- [ ] Non-applied preset warnings are not shown as active comparison warnings by default.
- [ ] Failed preset save/delete actions leave current comparison state and loaded preset list unchanged while surfacing user-visible preset action errors.
- [ ] Successful preset save/delete actions reconcile local preset state from the canonical mutation result without requiring an immediate preset-list reload.
- [ ] Comparison renders one column per selected **Option** and never silently drops or merges selected columns.
- [ ] The comparison region exposes horizontal overflow when columns exceed viewport width.
- [ ] `status: "na"` is visually distinguishable in comparison cells.
- [ ] Washer and dryer comparison uses the currently loaded direct **Option** data.
- [ ] `laundry-set` comparison in this slice stays limited to directly available loaded **Dimensions** and does not introduce delegated-field comparison or incomplete-entry grey-out behavior from #4.
- [ ] Until issue #4, `laundry-set` keys containing `.` are excluded from schema-default comparison keys, add-dimension choices, applied preset `effectiveDimensionKeys`, and save payloads in this renderer slice.
- [ ] Issue #6 does not change main/preload IPC contracts, storage files, or schema files.

## 11. Reviewer notes

Reviewers should reject implementations that:

- modify `src/main/**`, `src/preload/**`, or `schemas/**` for this renderer issue
- introduce a second persistence path instead of consuming `window.electronAPI`
- broaden the issue into general renderer-shell redesign unrelated to comparison
- show missing-**Dimension** warnings for every stored preset globally instead of tying the visible warning to the applied preset
- mutate comparison state or preset lists after failed `savePreset()`/`deletePreset()` results from issue #12
- silently drop selected comparison columns when the viewport is narrow
- introduce delegated `laundry-set` comparison or incomplete-entry semantics owned by #4
- surface delegated `laundry-set` keys containing `.` in defaults, add-dimension UI, or applied preset comparison state before issue #4
- persist ad hoc comparison selection state or unsaved current-view **Dimension** choices outside the explicit preset workflows

## 12. Required references for implementation and review

- `CONTEXT.md`
- `AGENTS.md`
- `docs/adr/0001-electron-vue-vite-stack.md`
- GitHub issue #6 body
- `src/renderer/src/App.vue`
- `src/renderer/src/main.js`
- `src/preload/index.js`
- `src/main/presetStorage.js`
- `src/main/schemaStorage.js`
- `schemas/laundry-set.schema.json`
- `schemas/washer.schema.json`
- `schemas/dryer.schema.json`
- `.opencode/plans/issue-12.md` for the preset contract consumed by this renderer slice
