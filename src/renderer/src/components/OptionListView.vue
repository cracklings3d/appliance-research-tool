<template>
  <section class="panel list-panel">
    <div class="panel-header">
      <div>
        <p class="panel-eyebrow">Active Appliance</p>
        <h2>{{ activeApplianceLabel }} Options</h2>
      </div>
      <button type="button" class="primary-button" :disabled="actionDisabled" @click="$emit('create')">
        Add Option
      </button>
    </div>

    <div v-if="loading" class="state-panel compact-state">
      <p>Loading {{ activeApplianceLabel }} Options…</p>
    </div>

    <div v-else-if="error" class="state-panel compact-state">
      <p class="state-title">Unable to load {{ activeApplianceLabel }} Options</p>
      <p>{{ error }}</p>
      <button type="button" class="secondary-button" @click="$emit('retry')">Retry</button>
    </div>

    <template v-else>
      <p v-if="refreshing" class="inline-note">Refreshing saved changes…</p>

      <div v-if="warnings.length" class="inline-warning-list">
        <p class="panel-eyebrow">Warnings</p>
        <ul>
          <li v-for="warning in warnings" :key="`${warning.applianceKey ?? activeApplianceKey}-${warning.code}`">
            {{ formatEntry(warning) }}
          </li>
        </ul>
      </div>

      <div v-if="!rows.length" class="state-panel compact-state">
        <p>No {{ activeApplianceLabel }} Options have been saved yet.</p>
      </div>

      <ul v-else class="option-list">
        <li v-for="row in rows" :key="row.id" class="option-row">
          <div>
            <p class="row-title">{{ row.label }}</p>
            <p class="row-subtitle">{{ row.subtitle }}</p>
          </div>
          <div class="row-actions">
            <button type="button" class="secondary-button" :disabled="actionDisabled" @click="$emit('edit', row.option)">
              Edit
            </button>
            <button type="button" class="danger-button" :disabled="actionDisabled" @click="$emit('delete', row.option)">
              Delete
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup>
defineProps({
  activeApplianceKey: {
    type: String,
    required: true
  },
  activeApplianceLabel: {
    type: String,
    required: true
  },
  rows: {
    type: Array,
    required: true
  },
  loading: {
    type: Boolean,
    default: false
  },
  refreshing: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: null
  },
  warnings: {
    type: Array,
    default: () => []
  },
  actionDisabled: {
    type: Boolean,
    default: false
  }
})

defineEmits(['create', 'edit', 'delete', 'retry'])

function formatEntry(entry) {
  if (!entry) {
    return 'Unknown warning.'
  }

  if (entry.message && entry.code) {
    return `${entry.message} (${entry.code})`
  }

  return entry.message ?? entry.code ?? 'Unknown warning.'
}
</script>
