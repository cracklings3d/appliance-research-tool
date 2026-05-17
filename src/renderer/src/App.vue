<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>Appliance Research Tool</h1>
        <p class="subtitle">Browse Appliance Options by schema-defined Dimensions.</p>
      </div>
    </header>

    <main class="app-main">
      <nav class="appliance-nav" aria-label="Appliance navigation">
        <button
          v-for="item in navigationItems"
          :key="item.key"
          type="button"
          class="appliance-nav__button"
          :class="{ 'appliance-nav__button--active': item.key === shellState.activeKey }"
          @click="selectAppliance(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>

      <section class="list-panel" aria-live="polite">
        <header class="list-panel__header">
          <h2>{{ activeLabel }}</h2>
          <p class="list-panel__description">Read-only Appliance list view</p>
        </header>

        <div v-if="view.status === 'loading'" class="state-card">
          <p>{{ view.message }}</p>
        </div>

        <div v-else-if="view.status === 'error'" class="state-card state-card--error">
          <p>{{ view.message }}</p>
          <button type="button" class="retry-button" @click="retryLoad">Retry</button>
        </div>

        <div v-else-if="view.status === 'empty'" class="state-card">
          <p>{{ view.message }}</p>
        </div>

        <div v-else class="table-wrap">
          <table class="option-table">
            <thead>
              <tr>
                <th v-for="column in view.columns" :key="column.id" scope="col">
                  {{ column.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in view.rows" :key="row.key">
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
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createAppShellController, createInitialState } from './shell/appShellController.mjs'

const shellState = ref(createInitialState())
const controller = createAppShellController()

let unsubscribe = () => {}

const navigationItems = computed(() => shellState.value.navigationItems)
const view = computed(() => shellState.value.view)
const activeLabel = computed(() => {
  const activeItem = shellState.value.navigationItems.find((item) => item.key === shellState.value.activeKey)
  return activeItem ? activeItem.label : 'Washer'
})

function selectAppliance(applianceKey) {
  void controller.selectAppliance(applianceKey)
}

function retryLoad() {
  void controller.retry()
}

onMounted(() => {
  unsubscribe = controller.subscribe((nextState) => {
    shellState.value = nextState
  })

  void controller.boot()
})

onBeforeUnmount(() => {
  unsubscribe()
  controller.dispose()
})
</script>
