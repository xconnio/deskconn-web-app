<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import type { DockPosition } from '@/stores/settings'

const props = defineProps<{ realm: string; focused: boolean }>()

const settingsStore = useSettingsStore()
</script>

<template>
  <div class="desktop-settings">
    <div class="desktop-settings-inner">
      <h4 class="desktop-settings-title">Appearance</h4>

      <div class="desktop-settings-card">
        <div class="desktop-settings-row">
          <p class="mb-0 fw-semibold">Task bar position</p>
          <select
            class="form-select form-select-sm desktop-settings-select"
            :value="settingsStore.getDockPosition(props.realm)"
            @change="settingsStore.setDockPosition(props.realm, ($event.target as HTMLSelectElement).value as DockPosition)"
          >
            <option value="bottom">Bottom</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </div>

        <hr class="desktop-settings-divider" />

        <div class="desktop-settings-row">
          <p class="mb-0 fw-semibold">Resource Monitor refresh interval</p>
          <select
            class="form-select form-select-sm desktop-settings-select"
            :value="settingsStore.getResourceMonitorInterval(props.realm)"
            @change="settingsStore.setResourceMonitorInterval(props.realm, parseInt(($event.target as HTMLSelectElement).value, 10))"
          >
            <option value="1">1 second</option>
            <option value="5">5 seconds</option>
            <option value="10">10 seconds</option>
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">60 seconds</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.desktop-settings {
  display: flex;
  justify-content: center;
  height: 100%;
  padding: 2.5rem 1.5rem;
  background: #f4f5f7;
}

.desktop-settings-inner {
  width: 100%;
  max-width: 420px;
}

.desktop-settings-title {
  margin: 0 0 1.25rem;
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
  color: #1e2328;
}

.desktop-settings-card {
  background: #ffffff;
  border: 1px solid #e2e4e8;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.desktop-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
}

.desktop-settings-divider {
  margin: 0;
  border-color: #e8ecf0;
}

.desktop-settings-select {
  width: 130px;
  flex-shrink: 0;
  cursor: pointer;
}
</style>
