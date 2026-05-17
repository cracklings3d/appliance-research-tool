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
          <tr v-for="row in view.rows" :key="row.key">
            <td>
              <label class="compare-toggle">
                <input
                  type="checkbox"
                  :checked="selectedOptionIds.includes(row.key)"
                  @change="$emit('toggle-option', row.key)"
                >
                <span>Compare</span>
              </label>
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
defineProps({
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

defineEmits(['retry', 'toggle-option'])
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
</style>
