<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router'

import { openFiles, openIndexedFiles } from '../router/navigation'
import { useMachinesStore } from '../stores/machines'
import { useSettingsStore } from '../stores/settings'
import TerminalPanel from '../components/TerminalPanel.vue'
import WindowTitleBar from '../components/WindowTitleBar.vue'

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

onMounted(() => {
  window.addEventListener('popstate', handlePopState)
  document.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
  document.removeEventListener('keydown', handleKeydown)
})

onBeforeRouteUpdate(() => {
  activeTerminal.value = false
  hasTerminalHistoryEntry = false
})

const launcherGridRef = ref<HTMLElement | null>(null)
const selectedAppId = ref<string | null>(null)

const notSupported = computed(() => !!route.query.notSupported)
function dismissNotSupported() {
  const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== 'notSupported'))
  router.replace({ params: route.params, query: rest })
}

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
  {
    id: 'pictures',
    label: 'Pictures',
    icon: 'bi-images',
    iconColor: '#ec4899',
    iconBg: '#fce7f3',
    action: () => openIndexedFiles(realm.value, 'pictures', desktopName.value),
  },
  {
    id: 'videos',
    label: 'Videos',
    icon: 'bi-collection-play-fill',
    iconColor: '#7c3aed',
    iconBg: '#ede9fe',
    action: () => openIndexedFiles(realm.value, 'videos', desktopName.value),
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'bi-file-earmark-richtext-fill',
    iconColor: '#d97706',
    iconBg: '#fef3c7',
    action: () => openIndexedFiles(realm.value, 'documents', desktopName.value),
  },
]

function columnCount(): number {
  if (!launcherGridRef.value) return 1
  return window.getComputedStyle(launcherGridRef.value).gridTemplateColumns.split(' ').length
}

function handleKeydown(e: KeyboardEvent) {
  if (activeTerminal.value) return
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  if (e.key === 'Escape') { close(); return }

  const idx = apps.findIndex(a => a.id === selectedAppId.value)
  const cols = columnCount()

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      selectedAppId.value = apps[Math.min(idx < 0 ? 0 : idx + cols, apps.length - 1)]!.id
      break
    case 'ArrowUp':
      e.preventDefault()
      selectedAppId.value = apps[Math.max(0, idx < 0 ? apps.length - 1 : idx - cols)]!.id
      break
    case 'ArrowRight':
      e.preventDefault()
      selectedAppId.value = apps[Math.min(idx < 0 ? 0 : idx + 1, apps.length - 1)]!.id
      break
    case 'ArrowLeft':
      e.preventDefault()
      selectedAppId.value = apps[Math.max(0, idx < 0 ? 0 : idx - 1)]!.id
      break
    case 'Enter':
      if (selectedAppId.value) apps.find(a => a.id === selectedAppId.value)?.action()
      break
  }
}
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
    <WindowTitleBar @close="close">
      <span class="launcher-machine-icon">{{ machinesStore.desktops.find((d) => d.realm === realm)?.icon ?? '🖥️' }}</span>
      <span class="launcher-machine-name">{{ desktopName }}</span>
    </WindowTitleBar>

    <div v-if="notSupported" class="not-supported-banner">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span>Not supported — please upgrade your backend.</span>
      <button class="not-supported-dismiss" @click="dismissNotSupported">×</button>
    </div>

    <div class="launcher-body">
    <div ref="launcherGridRef" class="launcher-grid">
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



.not-supported-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
  background: #fef3c7;
  border-bottom: 1px solid #fbbf24;
  color: #92400e;
  font-size: 0.8rem;
  font-weight: 500;
}

.not-supported-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: #92400e;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0;
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
