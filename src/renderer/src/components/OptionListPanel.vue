<template>
  <section class="panel" aria-live="polite">
    <header class="panel__header">
      <h2>{{ activeLabel }}</h2>
      <p class="panel__description">Read-only Appliance list view with Comparison selection.</p>
    </header>

    <div v-if="view.status === 'loading'" class="state-card">
      <p>{{ view.message }}</p>
    </div>

    <div v-else-if="view.status === 'error'" class="state-card state-card--error">
      <p>{{ view.message }}</p>
      <button type="button" class="retry-button" @click="$emit('retry')">Retry</button>
    </div>

    <div v-else-if="view.status === 'empty'" class="state-card">
      <p>{{ view.message }}</p>
    </div>

    <div v-else class="table-wrap">
      <div v-if="view.filters.length" class="filter-panel">
        <div
          v-for="filter in view.filters"
          :key="filter.id"
          class="filter-card"
        >
          <label class="filter-label" :for="`filter-${filter.id}`">{{ filter.label }}</label>

          <template v-if="filter.type === 'string'">
            <div class="filter-inline-group">
              <select
                :id="`filter-mode-${filter.id}`"
                class="filter-select"
                :value="filter.draft.mode"
                @change="emitFilterPatch(filter.id, { mode: $event.target.value })"
              >
                <option value="exact">Exact</option>
                <option value="substring">Contains</option>
              </select>
              <input
                :id="`filter-${filter.id}`"
                class="filter-input"
                type="text"
                :value="filter.draft.value"
                @input="emitFilterPatch(filter.id, { value: $event.target.value })"
              >
            </div>
          </template>

          <template v-else-if="filter.type === 'enum'">
            <div class="filter-checkbox-list">
              <label
                v-for="value in filter.allowedValues"
                :key="value"
                class="filter-checkbox"
              >
                <input
                  type="checkbox"
                  :checked="filter.draft.selectedValues.includes(value)"
                  @change="toggleEnumValue(filter, value, $event.target.checked)"
                >
                <span>{{ value }}</span>
              </label>
            </div>
          </template>

          <template v-else-if="filter.type === 'boolean'">
            <select
              :id="`filter-${filter.id}`"
              class="filter-select"
              :value="resolveBooleanDraftValue(filter.draft.value)"
              @change="emitFilterPatch(filter.id, { value: parseBooleanDraftValue($event.target.value) })"
            >
              <option value="">Any</option>
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </template>

          <template v-else>
            <div class="filter-inline-group">
              <input
                :id="`filter-${filter.id}-min`"
                class="filter-input"
                type="text"
                inputmode="decimal"
                placeholder="Min"
                :value="filter.draft.min"
                @input="emitFilterPatch(filter.id, { min: $event.target.value })"
              >
              <input
                :id="`filter-${filter.id}-max`"
                class="filter-input"
                type="text"
                inputmode="decimal"
                placeholder="Max"
                :value="filter.draft.max"
                @input="emitFilterPatch(filter.id, { max: $event.target.value })"
              >
            </div>
          </template>
        </div>
      </div>

      <div v-if="view.hasActiveFilters && view.rows.length === 0" class="state-card state-card--compact">
        <p>{{ view.message }}</p>
      </div>

      <table class="option-table">
        <thead>
          <tr>
            <th scope="col">Compare</th>
            <th v-for="column in view.columns" :key="column.id" scope="col">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in view.rows"
            :key="row.key"
            :class="{
              'option-table__row--warning': row.filterMatchKind === 'na-warning',
              'option-row--incomplete': row.isIncomplete
            }"
            :data-incomplete-row="row.isIncomplete ? 'true' : null"
          >
            <td>
              <label class="compare-toggle">
                <input
                  type="checkbox"
                  :checked="selectedOptionIds.includes(row.key)"
                  @change="$emit('toggle-option', row.key)"
                >
                <span>Compare</span>
              </label>
              <span
                v-if="row.warning"
                class="row-warning-badge"
                :title="row.warning.title"
              >
                Warning
              </span>

              <p
                v-if="row.filterMatchKind === 'na-warning'"
                class="row-warning"
              >
                Warning: Active filters hit N/A for {{ row.filterWarningDimensionLabels.join(', ') }}.
              </p>
            </td>
            <td v-for="cell in row.cells" :key="cell.columnId">
              <span
                v-if="cell.kind === 'na'"
                :class="cell.className"
                :data-evaluation-state="cell.dataEvaluationState"
              >
                {{ cell.text }}
              </span>
              <span v-else>{{ cell.text }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  activeLabel: {
    type: String,
    required: true
  },
  view: {
    type: Object,
    required: true
  },
  selectedOptionIds: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['retry', 'toggle-option', 'update-filter'])

function emitFilterPatch(dimensionId, patch) {
  emit('update-filter', { dimensionId, patch })
}

function toggleEnumValue(filter, value, isChecked) {
  const selectedValues = isChecked
    ? [...filter.draft.selectedValues, value]
    : filter.draft.selectedValues.filter((candidate) => candidate !== value)

  emitFilterPatch(filter.id, { selectedValues })
}

function resolveBooleanDraftValue(value) {
  if (value === true) {
    return 'true'
  }

  if (value === false) {
    return 'false'
  }

  return ''
}

function parseBooleanDraftValue(value) {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return null
}
</script>

<style scoped>
.panel {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
  padding: 1.25rem;
  min-height: 20rem;
}

.panel__header {
  margin-bottom: 1rem;
}

.panel__description {
  color: #526173;
  margin-top: 0.25rem;
}

.compare-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
}

.table-wrap {
  display: grid;
  gap: 1rem;
}

.filter-panel {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.filter-card {
  display: grid;
  gap: 0.5rem;
  padding: 0.85rem;
  border: 1px solid #d9e2ec;
  border-radius: 12px;
  background: #f8fbff;
}

.filter-label {
  font-weight: 700;
}

.filter-inline-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.filter-input,
.filter-select {
  width: 100%;
  border: 1px solid #bcccdc;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  background: #ffffff;
}

.filter-checkbox-list {
  display: grid;
  gap: 0.4rem;
}

.filter-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.row-warning {
  margin: 0.5rem 0 0;
  color: #9a6700;
  font-size: 0.9rem;
  font-weight: 600;
}

.option-table__row--warning {
  background: #fff9db;
}

.option-row--incomplete {
  opacity: 0.55;
}

.row-warning-badge {
  display: inline-flex;
  margin-top: 0.4rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: #fff7d6;
  border: 1px solid #e0c463;
  color: #7a4b00;
  font-size: 0.85rem;
  font-weight: 700;
}
</style>
