<template>
  <section class="panel" aria-live="polite">
    <header class="panel__header">
      <div>
        <h2>Comparison</h2>
        <p class="panel__description">Side-by-side Comparison for {{ activeLabel }} Options.</p>
      </div>
    </header>

    <div v-if="comparison.status === 'loading'" class="state-card">
      <p>Loading Comparison…</p>
    </div>

    <div v-else-if="comparison.status === 'error'" class="state-card state-card--error">
      <p>{{ comparison.statusMessage }}</p>
    </div>

    <template v-else>
      <div v-if="comparison.appliedPresetWarning" class="notice-banner notice-banner--warning" role="alert">
        <p class="notice-banner__title">
          {{ comparison.appliedPresetWarning.presetName }} has missing Dimensions.
        </p>
        <ul>
          <li v-for="message in comparison.appliedPresetWarning.messages" :key="message">{{ message }}</li>
        </ul>
      </div>

      <div class="comparison-toolbar">
        <section class="toolbar-card">
          <h3>Compared Dimensions</h3>
          <div class="toolbar-row">
            <select v-model="dimensionToAdd" :disabled="comparison.addableDimensions.length === 0">
              <option value="">Select a Dimension</option>
              <option
                v-for="dimension in comparison.addableDimensions"
                :key="dimension.id"
                :value="dimension.id"
              >
                {{ dimension.label }}
              </option>
            </select>
            <button type="button" class="action-button" :disabled="dimensionToAdd === ''" @click="emitAddDimension">
              Add Dimension
            </button>
          </div>
          <ul class="dimension-list">
            <li v-for="dimension in comparedDimensions" :key="dimension.id" class="dimension-pill">
              <span>{{ dimension.label }}</span>
              <button type="button" class="dimension-pill__remove" @click="$emit('remove-dimension', dimension.id)">
                Remove
              </button>
            </li>
          </ul>
        </section>

        <section class="toolbar-card">
          <h3>Comparison Presets</h3>

          <div class="toolbar-row">
            <input
              :value="comparison.presetSaveName"
              type="text"
              placeholder="Preset name"
              @input="$emit('update-save-name', $event.target.value)"
            >
            <button type="button" class="action-button" @click="$emit('save-preset')">
              Save Preset
            </button>
          </div>

          <ul v-if="comparison.presetSaveValidationErrors.length > 0" class="message-list message-list--error">
            <li v-for="error in comparison.presetSaveValidationErrors" :key="error.code || error.message">
              {{ error.message }}
            </li>
          </ul>

          <p v-if="comparison.presetActionError" class="inline-error" role="alert">
            {{ comparison.presetActionError }}
          </p>

          <div v-if="comparison.presetLoadStatus === 'loading'" class="state-card state-card--compact">
            <p>Loading Comparison presets…</p>
          </div>

          <div v-else-if="comparison.presetLoadStatus === 'error'" class="state-card state-card--error state-card--compact">
            <p>{{ comparison.presetLoadMessage }}</p>
            <button type="button" class="retry-button" @click="$emit('retry-presets')">Retry preset load</button>
          </div>

          <ul v-else-if="comparison.presets.length > 0" class="preset-list">
            <li v-for="preset in comparison.presets" :key="preset.id" class="preset-list__item">
              <div>
                <p class="preset-list__name">{{ preset.name }}</p>
              </div>
              <div class="preset-list__actions">
                <button
                  type="button"
                  class="action-button action-button--secondary"
                  :aria-pressed="preset.id === comparison.appliedPresetId"
                  @click="$emit('apply-preset', preset.id)"
                >
                  Apply
                </button>
                <button type="button" class="action-button action-button--danger" @click="$emit('delete-preset', preset.id)">
                  Delete
                </button>
              </div>
            </li>
          </ul>

          <p v-else class="empty-copy">No saved Comparison presets for this Appliance yet.</p>
        </section>
      </div>

      <div v-if="comparison.selectedOptions.length === 0" class="state-card">
        <p>Select one or more Options from the active list to start a side-by-side Comparison.</p>
      </div>

      <div v-else-if="comparison.rows.length === 0" class="state-card">
        <p>No Dimensions are currently selected for Comparison.</p>
      </div>

      <div v-else class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th scope="col">Dimension</th>
              <th
                v-for="option in comparison.selectedOptions"
                :key="option.id"
                scope="col"
                :class="{ 'comparison-option--incomplete': option.isIncomplete }"
                :data-incomplete-comparison-option="option.isIncomplete ? 'true' : null"
              >
                <span>{{ option.label }}</span>
                <span
                  v-if="option.warning"
                  class="comparison-option-warning"
                  :title="option.warning.title"
                >
                  {{ option.warning.text }}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in comparison.rows" :key="row.key">
              <th scope="row">{{ row.label }}</th>
              <td
                v-for="cell in row.cells"
                :key="`${row.key}-${cell.optionId}`"
                :class="{ 'comparison-option--incomplete': isIncompleteOption(cell.optionId) }"
              >
                <span
                  v-if="cell.kind === 'na'"
                  :class="cell.className"
                  :data-evaluation-state="cell.dataEvaluationState"
                >
                  {{ cell.text }}
                </span>
                <span v-else-if="cell.kind === 'empty'" class="comparison-empty-cell">{{ cell.text }}</span>
                <span v-else>{{ cell.text }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  activeLabel: {
    type: String,
    required: true
  },
  comparison: {
    type: Object,
    required: true
  },
  viewStatus: {
    type: String,
    required: true
  }
})

const emit = defineEmits([
  'add-dimension',
  'remove-dimension',
  'apply-preset',
  'delete-preset',
  'update-save-name',
  'save-preset',
  'retry-presets'
])

const dimensionToAdd = ref('')

const comparedDimensions = computed(() => {
  const dimensionsById = new Map(props.comparison.availableDimensions.map((dimension) => [dimension.id, dimension]))
  return props.comparison.comparedDimensionKeys
    .map((dimensionKey) => dimensionsById.get(dimensionKey))
    .filter(Boolean)
})

const incompleteOptionIds = computed(() => new Set(
  props.comparison.selectedOptions
    .filter((option) => option.isIncomplete)
    .map((option) => option.id)
))

watch(() => props.comparison.addableDimensions, (nextDimensions) => {
  if (!nextDimensions.some((dimension) => dimension.id === dimensionToAdd.value)) {
    dimensionToAdd.value = ''
  }
}, { deep: true })

function emitAddDimension() {
  if (dimensionToAdd.value === '') {
    return
  }

  emit('add-dimension', dimensionToAdd.value)
  dimensionToAdd.value = ''
}

function isIncompleteOption(optionId) {
  return incompleteOptionIds.value.has(optionId)
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

.notice-banner {
  border-radius: 12px;
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
}

.notice-banner--warning {
  background: #fff7d6;
  border: 1px solid #e0c463;
}

.notice-banner__title {
  font-weight: 700;
  margin-bottom: 0.4rem;
}

.comparison-toolbar {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  margin-bottom: 1rem;
}

.toolbar-card {
  border: 1px solid #d5dde8;
  border-radius: 12px;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}

.toolbar-card h3 {
  font-size: 1rem;
}

.toolbar-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.toolbar-row input,
.toolbar-row select {
  flex: 1 1 12rem;
  border: 1px solid #b9c8da;
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  background: #fff;
}

.action-button {
  border: none;
  border-radius: 10px;
  background: #20344d;
  color: #fff;
  padding: 0.6rem 1rem;
  cursor: pointer;
}

.action-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.action-button--secondary {
  background: #526173;
}

.action-button--danger {
  background: #b42318;
}

.dimension-list,
.preset-list,
.message-list {
  list-style: none;
  display: grid;
  gap: 0.65rem;
}

.dimension-pill {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border: 1px solid #d5dde8;
  border-radius: 999px;
  padding: 0.45rem 0.75rem;
}

.dimension-pill__remove {
  border: none;
  background: transparent;
  color: #20344d;
  font-weight: 700;
  cursor: pointer;
}

.preset-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid #d5dde8;
  border-radius: 12px;
  padding: 0.75rem;
}

.preset-list__name {
  font-weight: 700;
}

.preset-list__meta {
  color: #7a4b00;
  font-size: 0.9rem;
}

.preset-list__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.inline-error {
  color: #b42318;
  font-weight: 600;
}

.message-list--error {
  color: #b42318;
}

.empty-copy {
  color: #526173;
}

.state-card--compact {
  padding: 0.8rem 1rem;
}

.comparison-table-wrap {
  overflow-x: auto;
}

.comparison-table {
  border-collapse: collapse;
  min-width: max-content;
}

.comparison-table th,
.comparison-table td {
  text-align: left;
  vertical-align: top;
  padding: 0.85rem 0.75rem;
  border-bottom: 1px solid #e4eaf1;
  min-width: 12rem;
}

.comparison-table th:first-child,
.comparison-table td:first-child {
  min-width: 10rem;
}

.comparison-empty-cell {
  color: #7b8794;
}

.comparison-option--incomplete {
  opacity: 0.55;
}

.comparison-option-warning {
  display: inline-flex;
  margin-left: 0.45rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: #fff7d6;
  border: 1px solid #e0c463;
  color: #7a4b00;
  font-size: 0.8rem;
  font-weight: 700;
}

@media (max-width: 720px) {
  .panel {
    padding: 1rem;
  }
}
</style>
