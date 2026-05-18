# Canonical Plan — Issue #7: Add list filtering and N/A Warning behavior to appliance list views

- Issue: [#7](https://github.com/cracklings3d/appliance-research-tool/issues/7)
- Repository: `cracklings3d/appliance-research-tool`
- Status: implementation-ready
- Canonical scope owner: this file is the sole source of truth for issue #7

## 1. Clarified objective

Implement renderer-side list filtering for the existing single-**Appliance** read-only **Option** list view so users can filter visible **Options** by schema-defined **Dimensions** while preserving the existing schema-defined default list ordering and surfacing an explicit visible **Warning** when a relevant filtered **Dimension** has an `na` **Evaluation**.

This slice must:

- stay inside the existing renderer list-view foundation already present in this worktree
- consume the current schema and **Option** data already exposed through `window.electronAPI`
- support `string`, `enum`, `boolean`, and `numeric` filter behavior exactly as defined in issue #7
- keep **Options** with relevant `na` **Evaluations** visible under active filters, but below complete matches
- visibly differentiate both row-level kept-visible **Warning** state and cell-level N/A **Evaluation** state in the read-only list view
- avoid changing CRUD flows, preload/main-process APIs, persistence contracts, schema files, or user-controlled ordering behavior

## 2. Scope boundaries

### In scope

- renderer-side filtering controls and filtered-result presentation for the existing read-only **Option** list surface
- schema-derived filter metadata for direct visible **Dimensions** of types `string`, `enum`, `boolean`, and `numeric`
- exact-match and case-insensitive substring modes for `string` **Dimensions**
- multi-select OR behavior within a single `enum` **Dimension`
- exact-match behavior for `boolean` **Dimensions**
- min/max range behavior for `numeric` **Dimensions**
- stable partitioning of complete matches above N/A-kept rows while preserving existing default list order within each block
- explicit visible row-level **Warning** state for **Options** kept visible because one or more relevant filtered **Dimensions** are `na`
- keeping existing **Comparison** selection behavior intact while filters are added to the shared read-only list foundation
- focused renderer tests for filter derivation, match classification, ordering partition, controller integration, and Warning presentation evidence

### Out of scope

- any Electron main-process, preload, or IPC contract change
- schema-file edits or schema-contract redesign
- **Option** persistence changes from issue #11
- CRUD form/list behavior in `OptionListView.vue`
- new user-controlled ordering, sorting UI, ranking UI, or scoring logic
- multi-**Appliance** filtering
- cross-**Dimension** boolean composition beyond default AND and enum-internal OR
- **Comparison** feature redesign beyond preserving existing issue-#6 behavior against the new filtered list foundation
- delegated **Laundry Set** filtering for `washer.*` / `dryer.*` keys or pointer-target filtering behavior

## 3. Repository facts that constrain the plan

- `CONTEXT.md` and `AGENTS.md` require the exact vocabulary **Appliance**, **Option**, **Dimension**, **Evaluation**, and **Warning**, and explicitly state that relevant N/A filtering behavior must keep the **Option** visible with a visible **Warning**.
- ADR `docs/adr/0001-electron-vue-vite-stack.md` keeps this work in the Vue renderer; no storage/preload work belongs in this issue.
- `src/preload/index.js` already exposes the only data dependencies this issue needs: `listSchemas()`, `loadSchema(applianceKey)`, and `loadOptions(applianceKey)`.
- `src/renderer/src/shell/listViewModel.mjs` already owns schema-derived visible-column derivation, cell normalization, and default list ordering. Issue #7 should extend this read-only list model rather than create a second list pipeline.
- `src/renderer/src/shell/appShellController.mjs` already loads schema plus **Options** and produces the active read-only list state; filter state should integrate into this controller boundary rather than bypass it from the template.
- `src/renderer/src/components/OptionListPanel.vue` is the existing read-only table with **Comparison** selection controls. This is the correct renderer surface for filter controls, filtered rows, N/A cell styling, and per-row **Warning** display.
- `src/renderer/src/components/OptionListView.vue` is the separate CRUD-oriented list panel and already shows CRUD warnings. Issue #7 must not repurpose it as the read-only filtering surface.
- `src/renderer/src/composables/comparisonWorkspace.mjs` currently derives `orderedOptions` from `shell.view.rows`. If issue #7 naively replaces `view.rows` with filtered rows only, **Comparison** selection and column rendering from issue #6 will drift. The implementation must preserve an unfiltered default-ordered row set for **Comparison** state while filtered rows drive only the read-only list surface.
- Current schemas show the relevant filterable direct types in scope:
  - `washer`: `string`, `numeric`, `enum`
  - `dryer`: `string`, `numeric`, `enum`, `boolean`
  - `laundry-set`: direct `string` and `numeric`, while pointer/delegated fields remain excluded from the read-only list foundation
- `listViewModel.mjs` already normalizes absent optional visible **Evaluations** to N/A in list cells, matching `CONTEXT.md` line 34 that MVP does not distinguish missing vs N/A. Filtering must stay consistent with that normalization.

## 4. Assumptions carried by this plan

- String-filter controls default to exact-match mode until the user explicitly switches that **Dimension** to case-insensitive substring mode.
- A relevant filtered **Dimension** with an absent optional persisted **Evaluation** is treated the same as `{ status: 'na' }` for issue #7, because the current renderer list model already normalizes such cells to N/A and the domain model does not distinguish missing from N/A in MVP.
- Applying or changing filters must not automatically clear existing **Comparison** selections; selected **Options** remain selected until the active **Appliance** changes or the underlying loaded **Option** disappears from the appliance dataset.

## 5. Required implementation shape

### 5.1 Renderer architecture boundary

Keep production changes inside renderer list-view files.

Recommended shape:

- extend `src/renderer/src/shell/listViewModel.mjs` with pure filter derivation and row-classification helpers
- extend `src/renderer/src/shell/appShellController.mjs` so active list state owns both canonical ordered rows and the currently visible filtered rows
- update `src/renderer/src/composables/comparisonWorkspace.mjs` only as needed to consume canonical unfiltered ordered rows instead of filtered visible rows
- update `src/renderer/src/components/OptionListPanel.vue` to render filter controls, filtered empty state, and row-level **Warning** presentation
- update `src/renderer/src/App.vue` only for wiring new list-filter events/props through the existing workspace controller

Do not move filtering into preload or main-process code.

### 5.2 Canonical list state split

Issue #7 must separate these two concepts inside the read-only list state:

1. **Canonical ordered rows** — the full active-**Appliance** row set after existing schema-defined default list ordering is applied.
2. **Visible filtered rows** — the rows currently shown in the read-only list after applying issue-#7 filters and the complete-match / N/A-kept partition.

Normative consequences:

- default ordering is computed once from the full active **Option** set using existing issue-#2 behavior
- filtering is a stable post-ordering transformation, not a second sorting system
- complete matches and N/A-kept rows are formed by stable partition over the canonical ordered rows
- `comparisonWorkspace.mjs` must keep using the canonical ordered row set for selected **Option** pruning and column ordering so issue #6 semantics do not change merely because the list view is filtered
- `OptionListPanel.vue` must render only the visible filtered rows

### 5.3 Schema-derived filter contract

Filter controls must be derived from the active schema/list model rather than hand-authored per **Appliance**.

Eligible filter **Dimensions** are the same direct visible **Dimensions** already used by the read-only list foundation:

- include `string`, `enum`, `boolean`, and `numeric`
- exclude `pointer`
- for `laundry-set`, continue excluding `washer`, `dryer`, and any dotted delegated keys such as `washer.capacityKg` or `dryer.noiseLevel`

Recommended per-**Dimension** filter draft shape:

- `string`: `{ mode: 'exact' | 'substring', value: string }`
- `enum`: `{ selectedValues: string[] }`
- `boolean`: `{ value: true | false | null }`
- `numeric`: `{ min: string, max: string }`

Activation rules:

- `string` filter is active only when `value.trim() !== ''`
- `enum` filter is active only when `selectedValues.length > 0`
- `boolean` filter is active only when `value` is `true` or `false`
- `numeric` filter is active when at least one parseable bound is present; empty min/max means that side is unbounded

### 5.4 Filter matching semantics

Filtering must evaluate against raw **Evaluation** values, not rendered cell text.

Per-**Dimension** classification for an active filter:

- `known-match` — the **Option** has a `known` **Evaluation** satisfying the active filter
- `na-keep` — the **Option** has a relevant `na` or normalized-missing **Evaluation** for that filtered **Dimension**
- `reject` — the **Option** has a `known` **Evaluation** that does not satisfy the active filter, or malformed data that cannot be treated as N/A

Type-specific rules:

- `string` exact mode: raw `known` string value must equal the requested string exactly
- `string` substring mode: raw `known` string value must contain the requested string case-insensitively
- `enum`: raw `known` string value must equal any selected allowed value for that same **Dimension**
- `boolean`: raw `known` boolean value must equal the requested boolean value
- `numeric`: raw `known` numeric value must satisfy all active min/max bounds

Cross-**Dimension** composition:

- combine active filter **Dimensions** with logical AND
- combine multiple selected values inside one `enum` **Dimension** with logical OR
- include the **Option** if and only if every active filter **Dimension** is either `known-match` or `na-keep`
- classify the row as `na-warning` when at least one active filter **Dimension** is `na-keep` and none are `reject`
- classify the row as `complete-match` only when every active filter **Dimension** is `known-match`

### 5.5 Filtered-result ordering and empty states

Result ordering rules are normative:

- if no filters are active, the visible row list equals the canonical ordered row list
- when filters are active, visible rows are partitioned into:
  1. complete matches
  2. N/A-kept rows with visible **Warning** state
- within each block, preserve canonical ordered-row order exactly
- do not introduce any secondary sort based on warning count, **Dimension** count, label text, or filter type

Visible empty-state rules:

- if the appliance has zero loaded **Options**, keep the existing appliance-empty behavior
- if the appliance has loaded **Options** but active filters produce zero visible rows, show a filtered-empty state specific to the current filters rather than pretending the appliance has no saved **Options**

### 5.6 Warning and N/A presentation rules

Issue #7 has two distinct presentation requirements that must not be conflated:

1. **Cell-level N/A presentation** — existing list cells with N/A **Evaluations** stay visually differentiated from `known` **Evaluations**.
2. **Row-level kept-visible Warning** — any row included only because one or more relevant active filters encountered N/A must show an explicit visible **Warning** on that row.

Normative Warning behavior:

- the **Warning** must be visible in the row without hover-only discovery
- the Warning must be tied to the kept-visible row, not only shown as a global list banner
- the Warning should identify that active filters hit N/A for one or more relevant **Dimensions**; including the affected **Dimension** labels is recommended
- rows that merely contain unrelated N/A cells but were not kept by an active filter must not receive the kept-visible Warning state

Recommended row metadata from the list model:

- `filterMatchKind: 'complete-match' | 'na-warning'`
- `filterWarningDimensionIds` / `filterWarningDimensionLabels` for explicit Warning copy

### 5.7 Controller and component wiring

The active list controller should expose enough state for the list surface without forcing `App.vue` to reimplement filter logic.

Minimum behavior to wire through the controller layer:

- initialize empty/inactive filter drafts when schema plus ordered rows load for the active **Appliance**
- reset filter state when the active **Appliance** changes
- preserve active filter drafts across list refreshes for the same **Appliance**
- recompute visible filtered rows after every filter edit and every same-**Appliance** data reload
- keep canonical ordered rows available separately from visible filtered rows

Component boundary requirements:

- `OptionListPanel.vue` owns filter UI and renders the filtered visible rows
- `OptionListView.vue` remains CRUD-only and must not gain issue-#7 filter state or Warning logic
- `App.vue` should pass filter update events to the workspace/controller but should not become the place where matching logic lives

### 5.8 Testing strategy boundary

Stay with the existing narrow `node:test` approach.

Prefer:

- pure helper tests for filter activation, match classification, and row partitioning
- controller tests for active-**Appliance** resets and same-**Appliance** refresh behavior
- comparison-workspace regression tests proving filters do not clear or reorder existing **Comparison** selections
- lightweight component-evidence/static tests or focused UI tests for Warning rendering instead of introducing a new end-to-end framework

## 6. Machine-readable change scope

```json
{
  "allowed_paths": [
    ".opencode/plans/issue-7.md",
    "src/renderer/src/App.vue",
    "src/renderer/src/assets/main.css",
    "src/renderer/src/components/**/*.vue",
    "src/renderer/src/shell/**/*.mjs",
    "src/renderer/src/composables/**/*.mjs",
    "test/**/*.js"
  ],
  "optional_new_paths": [
    "src/renderer/src/components/OptionFilterBar.vue",
    "src/renderer/src/shell/listFilterModel.mjs",
    "test/renderer/listFilterModel.test.js"
  ],
  "forbidden_paths": [
    "src/main/**",
    "src/preload/**",
    "schemas/**",
    "electron-builder.json",
    "package.json",
    ".opencode/plans/issue-5.md",
    ".opencode/plans/issue-6.md",
    ".opencode/plans/issue-10.md",
    ".opencode/plans/issue-11.md",
    ".opencode/plans/issue-12.md"
  ],
  "likely_touched_paths": [
    "src/renderer/src/App.vue",
    "src/renderer/src/assets/main.css",
    "src/renderer/src/components/OptionListPanel.vue",
    "src/renderer/src/composables/comparisonWorkspace.mjs",
    "src/renderer/src/shell/appShellController.mjs",
    "src/renderer/src/shell/listViewModel.mjs",
    "test/renderer/appShellController.test.js",
    "test/renderer/comparisonWorkspace.test.js",
    "test/renderer/listViewModel.test.js"
  ],
  "shared_hotspots": [
    "src/renderer/src/App.vue",
    "src/renderer/src/components/OptionListPanel.vue",
    "src/renderer/src/composables/comparisonWorkspace.mjs",
    "src/renderer/src/shell/appShellController.mjs",
    "src/renderer/src/shell/listViewModel.mjs"
  ],
  "dependencies": [
    {
      "issue": 2,
      "reason": "Existing single-Appliance read-only list foundation and schema-defined default list ordering behavior already represented in the current renderer shell/list model."
    },
    {
      "issue": 6,
      "reason": "Comparison selection currently shares the read-only list foundation; issue #7 must preserve issue-#6 selection and ordering semantics while filters are added."
    },
    {
      "issue": 10,
      "reason": "Schema discovery/load contracts and schema metadata used to derive filterable Dimensions."
    },
    {
      "issue": 11,
      "reason": "Option/Evaluation load contracts and current Evaluation wrapper semantics consumed by the list model."
    }
  ],
  "non_goals": [
    "Adding user-controlled ordering, sorting UI, ranking, or scoring.",
    "Changing CRUD list behavior in OptionListView.vue.",
    "Adding delegated Laundry Set filtering for dotted keys or pointer-target filtering.",
    "Changing preload/main-process/schema contracts.",
    "Redesigning Comparison behavior beyond preserving current issue-#6 semantics under filtered list rendering."
  ]
}
```

## 7. Planned file touch list for implementation

### Expected files to change

- `.opencode/plans/issue-7.md` (this plan)
- `src/renderer/src/App.vue`
- `src/renderer/src/assets/main.css`
- `src/renderer/src/components/OptionListPanel.vue`
- `src/renderer/src/shell/appShellController.mjs`
- `src/renderer/src/shell/listViewModel.mjs`
- `src/renderer/src/composables/comparisonWorkspace.mjs`
- focused tests under `test/renderer/`

### Files that should remain untouched for this issue

- `src/main/**`
- `src/preload/**`
- `schemas/**`
- `src/renderer/src/components/OptionListView.vue` except for accidental shared-style fallout that review should reject
- persistence plans for other issues

## 8. Implementation sequence

1. Extend the list model with pure helpers for filterable **Dimension** derivation, filter activation, per-row match classification, and stable complete-match / N/A-kept partitioning.
2. Update `appShellController.mjs` so the active list state exposes both canonical ordered rows and visible filtered rows plus active filter state.
3. Update `comparisonWorkspace.mjs` to consume canonical ordered rows rather than filtered visible rows so selected **Options** and comparison ordering stay stable.
4. Add schema-derived filter controls and filtered-empty / Warning rendering to `OptionListPanel.vue`.
5. Wire filter events and props through `App.vue` without moving business logic into the template.
6. Add or adjust CSS only as needed for filter controls, visible Warning presentation, and filtered-empty state.
7. Add focused tests for helper semantics, controller state transitions, and comparison regression behavior.
8. Verify the implementation against section 10 before closing the issue.

## 9. Focused test plan

Required automated coverage:

1. **Filterable Dimension derivation**
   - derives only direct visible `string`, `enum`, `boolean`, and `numeric` **Dimensions**
   - excludes `pointer` and delegated `laundry-set` keys
   - preserves schema order
2. **String matching**
   - exact mode requires exact equality against raw `known` string values
   - substring mode matches case-insensitively
   - empty string leaves the filter inactive
3. **Enum / boolean / numeric matching**
   - enum multi-select uses OR within the same **Dimension**
   - boolean matches exact raw boolean values
   - numeric min-only, max-only, and bounded ranges behave correctly against raw numeric values
4. **N/A classification**
   - relevant active-filter `na` keeps the row visible with `na-warning`
   - known mismatch rejects the row even if another filtered **Dimension** is `na`
   - absent optional relevant **Evaluations** are treated consistently with N/A
5. **Stable partition and ordering**
   - complete matches render before N/A-kept rows
   - row order within each block preserves canonical default list order exactly
   - filtered-empty state is distinguishable from appliance-empty state
6. **Controller behavior**
   - changing the active **Appliance** resets filter state
   - same-**Appliance** retries preserve filter state and recompute visible rows from refreshed ordered rows
7. **Comparison regression behavior**
   - filters do not clear selected comparison **Option** ids for the same **Appliance**
   - comparison selected-column ordering still follows canonical ordered rows rather than filtered visible rows
8. **Renderer evidence**
   - N/A cells remain visually differentiated
   - rows kept by relevant N/A show an explicit visible **Warning** in the list surface
   - rows with unrelated N/A but no relevant active-filter N/A do not show the kept-visible Warning

## 10. Acceptance checklist mapped to issue #7

- [ ] Filtering is available only within the active single-**Appliance** read-only list view.
- [ ] Active filters across multiple **Dimensions** compose with logical AND.
- [ ] Multiple selected values within a single `enum` **Dimension** compose with logical OR.
- [ ] `string` **Dimension** filters support explicit exact-match and case-insensitive substring behavior against `known` **Evaluations**.
- [ ] `boolean` **Dimension** filters support explicit exact-match behavior against `known` **Evaluations**.
- [ ] `numeric` **Dimension** filters support explicit min/max range behavior against `known` **Evaluations**.
- [ ] Relevant filtered N/A **Evaluations** keep the affected **Option** visible instead of removing it from results.
- [ ] Every visible **Option** kept because of relevant N/A shows an explicit visible row-level **Warning**.
- [ ] N/A **Evaluations** remain visually differentiated from `known` **Evaluations** in list cells.
- [ ] Complete matches appear before N/A-kept rows.
- [ ] Within each visible result block, row order uses only the existing schema-defined default list ordering.
- [ ] No new user-controlled ordering, sorting, ranking, or scoring behavior is introduced.
- [ ] Filtering changes do not alter existing preload/main/schema contracts.
- [ ] Filtering changes do not repurpose CRUD list UI in `OptionListView.vue`.
- [ ] Filtering changes do not break existing **Comparison** selection/order semantics for the active **Appliance**.

## 11. Reviewer notes

Reviewers should reject implementations that:

- hard-code filter controls per **Appliance** instead of deriving them from schema/list metadata
- change `src/main/**`, `src/preload/**`, or `schemas/**` for this renderer issue
- use filtered visible rows as the only source for **Comparison** state and thereby clear or reorder issue-#6 selections
- show a global Warning banner without a visible kept-visible Warning on the affected row
- give rows a kept-visible Warning merely because they contain some unrelated N/A cell with no active filter relevance
- introduce new ordering or sorting behavior under the guise of filtering
- broaden scope into CRUD, preset redesign, delegated **Laundry Set** filtering, or persistence changes
- add a heavy renderer test framework when focused helper/controller tests are sufficient

## 12. Required references for implementation and review

- `CONTEXT.md`
- `AGENTS.md`
- `docs/adr/0001-electron-vue-vite-stack.md`
- GitHub issue #7 body
- `src/preload/index.js`
- `src/renderer/src/App.vue`
- `src/renderer/src/components/OptionListPanel.vue`
- `src/renderer/src/components/OptionListView.vue`
- `src/renderer/src/composables/comparisonWorkspace.mjs`
- `src/renderer/src/shell/appShellController.mjs`
- `src/renderer/src/shell/listViewModel.mjs`
- `schemas/washer.schema.json`
- `schemas/dryer.schema.json`
- `schemas/laundry-set.schema.json`
