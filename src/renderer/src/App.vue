<template>
  <div id="app">
    <header class="app-header">
      <h1>Appliance Research Tool</h1>
      <p class="subtitle">Plan and compare appliance purchases</p>
    </header>
    <main class="app-main">
      <p>Your Vue 3 + Electron app is running.</p>
      <p v-if="electronInfo">Running on {{ electronInfo.platform }} with Node {{ electronInfo.versions.node }}</p>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const electronInfo = ref(null)

onMounted(() => {
  if (window.electronAPI) {
    electronInfo.value = {
      platform: window.electronAPI.platform,
      versions: window.electronAPI.versions
    }
  }
})
</script>

<style scoped>
.app-header {
  background: #2c3e50;
  color: white;
  padding: 1.5rem 2rem;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.subtitle {
  margin: 0.25rem 0 0;
  opacity: 0.8;
}

.app-main {
  padding: 2rem;
}
</style>
