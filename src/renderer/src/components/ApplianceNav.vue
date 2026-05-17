<template>
  <nav class="panel appliance-nav" aria-label="Appliance navigation">
    <button
      v-for="appliance in appliances"
      :key="appliance.applianceKey"
      type="button"
      class="nav-button"
      :class="{ 'is-active': appliance.applianceKey === activeApplianceKey }"
      :disabled="disabled"
      @click="$emit('select', appliance.applianceKey)"
    >
      {{ appliance.displayName }}
    </button>
  </nav>
</template>

<script setup>
defineProps({
  appliances: {
    type: Array,
    required: true
  },
  activeApplianceKey: {
    type: String,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

defineEmits(['select'])
</script>
