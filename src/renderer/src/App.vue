<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>Appliance Research Tool</h1>
        <p class="subtitle">Browse Appliance Options and compare them side-by-side by schema-defined Dimensions.</p>
      </div>
    </header>

    <main class="app-main">
      <nav class="appliance-nav" aria-label="Appliance navigation">
        <button
          v-for="item in navigationItems"
          :key="item.key"
          type="button"
          class="appliance-nav__button"
          :class="{ 'appliance-nav__button--active': item.key === workspaceState.activeKey }"
          @click="selectAppliance(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="workspace-grid">
        <OptionListPanel
          :active-label="activeLabel"
          :view="view"
          :selected-option-ids="comparison.selectedOptionIds"
          @retry="retryLoad"
          @toggle-option="toggleOptionSelection"
        />

        <ComparisonPanel
          :active-label="activeLabel"
          :comparison="comparison"
          :view-status="view.status"
          @add-dimension="addComparedDimension"
          @remove-dimension="removeComparedDimension"
          @apply-preset="applyPreset"
          @delete-preset="deletePreset"
          @update-save-name="setPresetSaveName"
          @save-preset="savePreset"
          @retry-presets="retryPresetLoad"
        />
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ComparisonPanel from './components/ComparisonPanel.vue'
import OptionListPanel from './components/OptionListPanel.vue'
import { createComparisonWorkspaceController, createInitialState } from './composables/comparisonWorkspace.mjs'

const workspaceState = ref(createInitialState())
const controller = createComparisonWorkspaceController()

let unsubscribe = () => {}

const navigationItems = computed(() => workspaceState.value.navigationItems)
const view = computed(() => workspaceState.value.view)
const comparison = computed(() => workspaceState.value.comparison)
const activeLabel = computed(() => {
  const activeItem = workspaceState.value.navigationItems.find((item) => item.key === workspaceState.value.activeKey)
  return activeItem ? activeItem.label : 'Washer'
})

function selectAppliance(applianceKey) {
  void controller.selectAppliance(applianceKey)
}

function retryLoad() {
  void controller.retry()
}

function retryPresetLoad() {
  void controller.retryPresetLoad()
}

function toggleOptionSelection(optionId) {
  controller.toggleOptionSelection(optionId)
}

function addComparedDimension(dimensionKey) {
  controller.addComparedDimension(dimensionKey)
}

function removeComparedDimension(dimensionKey) {
  controller.removeComparedDimension(dimensionKey)
}

function applyPreset(presetId) {
  controller.applyPreset(presetId)
}

function setPresetSaveName(name) {
  controller.setPresetSaveName(name)
}

function savePreset() {
  void controller.savePreset()
}

function deletePreset(presetId) {
  void controller.deletePreset(presetId)
}

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    workspaceState.value = nextState
  })

  void controller.boot()
})

onBeforeUnmount(() => {
  unsubscribe()
  controller.dispose()
})
</script>

<style scoped>
.workspace-grid {
  display: grid;
  gap: 1rem;
}
</style>
