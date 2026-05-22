<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { openFiles } from '../router/navigation'
import { useMachinesStore } from '../stores/machines'
import { useSettingsStore } from '../stores/settings'
import TerminalPanel from '../components/TerminalPanel.vue'

const route = useRoute()
const router = useRouter()
const machinesStore = useMachinesStore()
const settingsStore = useSettingsStore()

const close = () => router.push('/')

const realm = computed(() => route.params.realm as string)
const desktopName = computed(() => {
  const name = route.query.name as string
  if (name) return name
  return machinesStore.desktops.find((d) => d.realm === realm.value)?.name ?? realm.value
})

const activeTerminal = ref(false)
let hasTerminalHistoryEntry = false

const openTerminal = () => {
  activeTerminal.value = true
}

const closeTerminal = () => {
  if (!activeTerminal.value) return
  if (hasTerminalHistoryEntry) {
    window.history.back()
    return
  }
  activeTerminal.value = false
}

const handlePopState = () => {
  if (!activeTerminal.value) return
  hasTerminalHistoryEntry = false
  activeTerminal.value = false
}

watch(activeTerminal, (next, previous) => {
  if (!next || previous) return
  window.history.pushState({ ...window.history.state, deskconnTerminal: true }, '')
  hasTerminalHistoryEntry = true
})

onMounted(() => window.addEventListener('popstate', handlePopState))
onUnmounted(() => window.removeEventListener('popstate', handlePopState))

const selectedAppId = ref<string | null>(null)

const apps = [
  {
    id: 'files',
    label: 'Files',
    icon: 'bi-folder2-open',
    iconColor: '#2563eb',
    iconBg: '#dbeafe',
    action: () => openFiles(realm.value, desktopName.value),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'bi-terminal',
    iconColor: '#334155',
    iconBg: '#e2e8f0',
    action: () => openTerminal(),
  },
]
</script>

<template>
  <!-- Terminal overlay -->
  <div v-if="activeTerminal" class="terminal-view fade-in-up">
    <TerminalPanel
      :realm="realm"
      :desktop-name="desktopName"
      @close="closeTerminal"
    />
  </div>

  <!-- Launcher -->
  <div v-else class="launcher-wrapper fade-in-up">
    <div class="launcher-header">
      <button class="tbar-btn" title="Close" @click="close">
        <i class="bi bi-x-lg"></i>
      </button>
      <span class="launcher-machine-icon">
        {{ machinesStore.desktops.find((d) => d.realm === realm)?.icon ?? '🖥️' }}
      </span>
      <h3 class="launcher-machine-name">{{ desktopName }}</h3>
    </div>

    <div class="launcher-body">
    <div class="launcher-grid">
      <button
        v-for="app in apps"
        :key="app.id"
        class="app-tile"
        :class="{ 'app-tile-selected': selectedAppId === app.id }"
        @click="settingsStore.singleClickOpen ? app.action() : (selectedAppId = app.id)"
        @dblclick="app.action()"
      >
        <div
          class="app-tile-card"
          :style="{ color: app.iconColor, background: app.iconBg }"
        >
          <i class="bi" :class="app.icon"></i>
        </div>
        <span class="app-tile-label">{{ app.label }}</span>
      </button>
    </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex: 1;
}

.launcher-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.launcher-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #e8ecf0;
  flex-shrink: 0;
}

.tbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.tbar-btn:hover {
  background: #f1f5f9;
  color: #111827;
}

.launcher-machine-icon {
  font-size: 1.15rem;
}

.launcher-machine-name {
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.launcher-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 1rem;
  flex: 1;
}

.launcher-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 0.2rem;
  width: 100%;
  align-content: start;
  padding: 0.35rem;
}

.app-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 0.8rem 0.4rem 0.7rem;
  gap: 0.5rem;
  border: 1.5px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.13s ease, border-color 0.13s ease;
}

.app-tile:hover {
  background: rgba(241, 245, 249, 0.9);
  border-color: rgba(0, 0, 0, 0.07);
}

.app-tile-selected {
  background: #dbeafe;
  border-color: rgba(59, 130, 246, 0.28);
}

.app-tile-card {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.65rem;
  flex-shrink: 0;
}

.app-tile-label {
  font-size: 0.69rem;
  font-weight: 600;
  color: #21313f;
  text-align: center;
  white-space: normal;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.35;
  max-width: 100%;
  word-break: break-word;
}
</style>
