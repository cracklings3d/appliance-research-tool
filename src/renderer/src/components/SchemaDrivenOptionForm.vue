<template>
  <section class="panel editor-panel">
    <div class="panel-header">
      <div>
        <p class="panel-eyebrow">Editor</p>
        <h2 v-if="mode === 'create'">Create {{ activeApplianceLabel }} Option</h2>
        <h2 v-else-if="mode === 'edit'">Edit {{ activeApplianceLabel }} Option</h2>
        <h2 v-else>Select a CRUD action</h2>
      </div>
    </div>

    <div v-if="!mode" class="state-panel compact-state">
      <p>Choose Add Option, Edit, or Delete from the active list.</p>
    </div>

    <form v-else class="editor-form" @submit.prevent="$emit('save')">
      <div v-if="callError" class="feedback-block feedback-error">
        {{ callError }}
      </div>

      <div v-if="formErrors.length" class="feedback-block feedback-error">
        <p class="feedback-title">Validation errors</p>
        <ul>
          <li v-for="(entry, index) in formErrors" :key="`${entry.code}-${index}`">
            {{ formatEntry(entry) }}
          </li>
        </ul>
      </div>

      <div v-if="pointerCatalogLoading" class="feedback-block feedback-muted">
        Loading Washer and Dryer catalogs for pointer selection…
      </div>

      <div v-else-if="pointerCatalogError" class="feedback-block feedback-error">
        {{ pointerCatalogError }}
      </div>

      <div v-for="field in fields" :key="field.id" class="field-card">
        <div class="field-header">
          <div>
            <label class="field-label" :for="`field-${field.id}`">{{ field.label }}</label>
            <p class="field-meta">
              {{ field.type }}
              <span v-if="field.unit">· {{ field.unit }}</span>
              <span v-if="field.required">· required</span>
            </p>
          </div>

          <label v-if="field.type !== 'pointer'" class="status-select">
            <span>Status</span>
            <select
              :value="draft[field.id]?.status ?? 'known'"
              :disabled="savePending"
              @change="onStatusChange(field.id, $event.target.value)"
            >
              <option value="known">Known</option>
              <option value="na">N/A</option>
            </select>
          </label>
        </div>

        <template v-if="field.type === 'string'">
          <input
            :id="`field-${field.id}`"
            type="text"
            class="text-input"
            :value="draft[field.id]?.value ?? ''"
            :disabled="isValueDisabled(field)"
            @input="onValueChange(field.id, $event.target.value)"
          >
        </template>

        <template v-else-if="field.type === 'numeric'">
          <input
            :id="`field-${field.id}`"
            type="text"
            inputmode="decimal"
            class="text-input"
            :value="draft[field.id]?.value ?? ''"
            :disabled="isValueDisabled(field)"
            @input="onValueChange(field.id, $event.target.value)"
          >
        </template>

        <template v-else-if="field.type === 'enum'">
          <select
            :id="`field-${field.id}`"
            class="text-input"
            :value="draft[field.id]?.value ?? ''"
            :disabled="isValueDisabled(field)"
            @change="onValueChange(field.id, $event.target.value)"
          >
            <option value="">Select a value</option>
            <option v-for="option in field.allowedValues" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </template>

        <template v-else-if="field.type === 'boolean'">
          <select
            :id="`field-${field.id}`"
            class="text-input"
            :value="serializeBooleanValue(draft[field.id]?.value)"
            :disabled="isValueDisabled(field)"
            @change="onBooleanChange(field.id, $event.target.value)"
          >
            <option value="">Select true or false</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </template>

        <template v-else-if="field.type === 'pointer'">
          <select
            :id="`field-${field.id}`"
            class="text-input"
            :value="draft[field.id]?.value ?? ''"
            :disabled="savePending || pointerCatalogLoading || Boolean(pointerCatalogError)"
            @change="onValueChange(field.id, $event.target.value)"
          >
            <option value="">Select a {{ field.label.toLowerCase() }}</option>
            <option
              v-for="choice in pointerChoicesByDimensionId[field.id] ?? []"
              :key="choice.value"
              :value="choice.value"
            >
              {{ choice.label }}
            </option>
          </select>
        </template>

        <ul v-if="fieldErrorsByDimensionId[field.id]?.length" class="field-errors">
          <li v-for="(entry, index) in fieldErrorsByDimensionId[field.id]" :key="`${entry.code}-${index}`">
            {{ formatEntry(entry) }}
          </li>
        </ul>
      </div>

      <div class="editor-actions">
        <button
          type="submit"
          class="primary-button"
          :disabled="savePending || pointerCatalogLoading || Boolean(pointerCatalogError)"
        >
          {{ savePending ? 'Saving…' : 'Save' }}
        </button>
        <button type="button" class="secondary-button" :disabled="savePending" @click="$emit('cancel')">
          Cancel
        </button>
      </div>
    </form>
  </section>
</template>

<script setup>
const props = defineProps({
  activeApplianceLabel: {
    type: String,
    required: true
  },
  mode: {
    type: String,
    default: null
  },
  fields: {
    type: Array,
    required: true
  },
  draft: {
    type: Object,
    required: true
  },
  fieldErrorsByDimensionId: {
    type: Object,
    required: true
  },
  formErrors: {
    type: Array,
    required: true
  },
  callError: {
    type: String,
    default: null
  },
  savePending: {
    type: Boolean,
    default: false
  },
  pointerCatalogLoading: {
    type: Boolean,
    default: false
  },
  pointerCatalogError: {
    type: String,
    default: null
  },
  pointerChoicesByDimensionId: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update-field', 'cancel', 'save'])

function onStatusChange(dimensionId, status) {
  emit('update-field', {
    dimensionId,
    patch: { status }
  })
}

function onValueChange(dimensionId, value) {
  emit('update-field', {
    dimensionId,
    patch: { value }
  })
}

function onBooleanChange(dimensionId, value) {
  let nextValue = null

  if (value === 'true') {
    nextValue = true
  } else if (value === 'false') {
    nextValue = false
  }

  onValueChange(dimensionId, nextValue)
}

function serializeBooleanValue(value) {
  if (value === true) {
    return 'true'
  }

  if (value === false) {
    return 'false'
  }

  return ''
}

function isValueDisabled(field) {
  return props.savePending || props.draft[field.id]?.status === 'na'
}

function formatEntry(entry) {
  if (!entry) {
    return 'Unknown validation error.'
  }

  if (entry.message && entry.code) {
    return `${entry.message} (${entry.code})`
  }

  return entry.message ?? entry.code ?? 'Unknown validation error.'
}
</script>
