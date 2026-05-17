<template>
  <div v-if="open" class="dialog-backdrop" role="presentation">
    <div class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
      <h2 id="delete-dialog-title">Delete {{ applianceLabel }} Option</h2>
      <p v-if="optionLabel" class="dialog-option-label">{{ optionLabel }}</p>

      <p v-if="loadingImpact">Preparing downstream impact…</p>
      <p v-else>{{ message }}</p>

      <p v-if="error" class="dialog-error">{{ error }}</p>

      <div class="editor-actions">
        <button
          type="button"
          class="danger-button"
          :disabled="loadingImpact || confirmPending || Boolean(error)"
          @click="$emit('confirm')"
        >
          {{ confirmPending ? 'Deleting…' : 'Confirm delete' }}
        </button>
        <button type="button" class="secondary-button" :disabled="confirmPending" @click="$emit('cancel')">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false
  },
  applianceLabel: {
    type: String,
    required: true
  },
  optionLabel: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  loadingImpact: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: null
  },
  confirmPending: {
    type: Boolean,
    default: false
  }
})

defineEmits(['cancel', 'confirm'])
</script>
