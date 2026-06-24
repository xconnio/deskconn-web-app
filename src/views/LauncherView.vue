<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, type Component } from 'vue'
import { useRoute, useRouter, onBeforeRouteUpdate } from 'vue-router'

import { useMachinesStore } from '../stores/machines'
import { useSettingsStore } from '../stores/settings'
import { useSessionCacheStore } from '../stores/sessionCache'
import { useWindowManager } from '../composables/useWindowManager'
import EmbeddedDesktopFiles from '../components/EmbeddedDesktopFiles.vue'
import EmbeddedIndexedFiles from '../components/EmbeddedIndexedFiles.vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import ResourceMonitor from '../components/ResourceMonitor.vue'
import FloatingWindow from '../components/FloatingWindow.vue'
import WindowTaskbar from '../components/WindowTaskbar.vue'
import { loadCachedWallpaper, storeWallpaper } from '../composables/useWallpaperCache'

const route = useRoute()
const router = useRouter()
const machinesStore = useMachinesStore()
const settingsStore = useSettingsStore()
const sessionCacheStore = useSessionCacheStore()

const close = () => router.push('/')

const realm = computed(() => route.params.realm as string)
const desktopName = computed(() => {
  const name = route.query.name as string
  if (name) return name
  return machinesStore.desktops.find((d) => d.realm === realm.value)?.name ?? realm.value
})

const {
  windows,
  focusedId,
  openWindow,
  closeWindow,
  focusWindow,
  minimizeWindow,
  restoreWindow,
  toggleMaximize,
  updateBounds,
} = useWindowManager()

const launcherBodyRef = ref<HTMLElement | null>(null)
const launcherGridRef = ref<HTMLElement | null>(null)
const selectedAppId = ref<string | null>(null)
const wallpaperUrl = ref<string | null>(null)
let activeWallpaperObjUrl: string | null = null

function applyWallpaperUrl(url: string | null, forRealm: string) {
  if (realm.value !== forRealm) return
  if (activeWallpaperObjUrl && activeWallpaperObjUrl !== url) URL.revokeObjectURL(activeWallpaperObjUrl)
  activeWallpaperObjUrl = url
  wallpaperUrl.value = url
}

async function fetchWallpaper(forRealm?: string) {
  if (!settingsStore.useRemoteWallpaper) {
    wallpaperUrl.value = null
    return
  }
  const targetRealm = forRealm ?? realm.value

  // Show persisted wallpaper immediately without any network call
  const cached = await loadCachedWallpaper(targetRealm)
  applyWallpaperUrl(cached?.url ?? null, targetRealm)

  try {
    const session = await sessionCacheStore.acquire(targetRealm)
    if (!session) return

    // Cheap md5 check — only download the full image when it has changed
    const checksumResult = await session.call('io.xconn.deskconn.deskconnd.wallpaper.checksum')
    const remoteChecksum = checksumResult.args?.[0] as string
    if (cached?.checksum === remoteChecksum) return

    const result = await session.call('io.xconn.deskconn.deskconnd.wallpaper.get')
    const mimeType = result.args?.[0] as string
    const data = result.args?.[1] as Uint8Array
    if (!data?.length) return

    const newUrl = await storeWallpaper(targetRealm, data, mimeType, remoteChecksum)
    applyWallpaperUrl(newUrl, targetRealm)
  } catch {
    // silently ignore — wallpaper is optional
  }
}

const isMobile = ref(window.innerWidth < 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth < 768
}

const notSupported = computed(() => !!route.query.notSupported)
function dismissNotSupported() {
  const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== 'notSupported'))
  router.replace({ params: route.params, query: rest })
}

interface AppDef {
  id: string
  label: string
  icon: string
  iconColor: string
  iconBg: string
  width?: number
  height?: number
}

const apps: AppDef[] = [
  {
    id: 'files',
    label: 'Files',
    icon: 'bi-folder2-open',
    iconColor: '#2563eb',
    iconBg: '#dbeafe',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'bi-terminal',
    iconColor: '#334155',
    iconBg: '#e2e8f0',
    width: 640,
    height: 420,
  },
  {
    id: 'pictures',
    label: 'Pictures',
    icon: 'bi-images',
    iconColor: '#ec4899',
    iconBg: '#fce7f3',
  },
  {
    id: 'videos',
    label: 'Videos',
    icon: 'bi-collection-play-fill',
    iconColor: '#7c3aed',
    iconBg: '#ede9fe',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'bi-file-earmark-richtext-fill',
    iconColor: '#d97706',
    iconBg: '#fef3c7',
  },
  {
    id: 'resource-monitor',
    label: 'Resource Monitor',
    icon: 'bi-bar-chart-line-fill',
    iconColor: '#0891b2',
    iconBg: '#cffafe',
    width: 480,
    height: 500,
  },
]

function launchApp(app: AppDef, initialPath?: string) {
  openWindow({
    appId: app.id,
    title: app.label,
    icon: app.icon,
    iconColor: app.iconColor,
    iconBg: app.iconBg,
    width: app.width,
    height: app.height,
    props: initialPath ? { initialPath } : {},
  })
}

const appComponents: Record<string, Component> = {
  files: EmbeddedDesktopFiles,
  terminal: TerminalPanel,
  pictures: EmbeddedIndexedFiles,
  videos: EmbeddedIndexedFiles,
  documents: EmbeddedIndexedFiles,
  'resource-monitor': ResourceMonitor,
}

function windowProps(win: { id: string; appId: string; props: Record<string, unknown> }) {
  const focused = focusedId.value === win.id
  switch (win.appId) {
    case 'files':
      return {
        realm: realm.value,
        desktopName: desktopName.value,
        initialPath: win.props.initialPath as string | undefined,
        focused,
      }
    case 'terminal':
      return {
        realm: realm.value,
        desktopName: desktopName.value,
        embedded: true,
      }
    case 'resource-monitor':
      return {
        realm: realm.value,
        desktopName: desktopName.value,
        focused,
      }
    default:
      return {
        realm: realm.value,
        category: win.appId,
        desktopName: desktopName.value,
        focused,
      }
  }
}

function onOpenFiles(path: string) {
  const filesApp = apps.find((a) => a.id === 'files')!
  launchApp(filesApp, path)
}

function onToggleMaximize(id: string) {
  const el = launcherBodyRef.value
  toggleMaximize(id, { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 })
}

function onTaskbarActivate(id: string) {
  const win = windows.value.find((w) => w.id === id)
  if (!win) return
  if (win.minimized) {
    restoreWindow(id)
  } else if (focusedId.value === id) {
    minimizeWindow(id)
  } else {
    focusWindow(id)
  }
}

onBeforeRouteUpdate((to) => {
  for (const win of [...windows.value]) closeWindow(win.id)
  fetchWallpaper(to.params.realm as string)
})

function columnCount(): number {
  if (!launcherGridRef.value) return 1
  return window.getComputedStyle(launcherGridRef.value).gridTemplateColumns.split(' ').length
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (focusedId.value) {
      closeWindow(focusedId.value)
    } else {
      close()
    }
    return
  }

  // A focused window owns the keyboard while it's open.
  if (focusedId.value) return

  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

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
    case 'Enter': {
      const app = apps.find(a => a.id === selectedAppId.value)
      if (app) launchApp(app)
      break
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateIsMobile)
  fetchWallpaper()
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', updateIsMobile)
  if (activeWallpaperObjUrl) URL.revokeObjectURL(activeWallpaperObjUrl)
})
</script>

<template>
  <div class="launcher-wrapper fade-in-up">
    <div v-if="notSupported" class="not-supported-banner">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span>Not supported — please upgrade your backend.</span>
      <button class="not-supported-dismiss" @click="dismissNotSupported">×</button>
    </div>

    <div
      ref="launcherBodyRef"
      class="launcher-body"
      :class="{ 'has-wallpaper': !!wallpaperUrl }"
      :style="wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
    >
      <div ref="launcherGridRef" class="launcher-grid">
        <button
          v-for="app in apps"
          :key="app.id"
          class="app-tile"
          :class="{ 'app-tile-selected': selectedAppId === app.id }"
          @click="settingsStore.singleClickOpen ? launchApp(app) : (selectedAppId = app.id)"
          @dblclick="launchApp(app)"
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

      <div class="windows-layer">
        <FloatingWindow
          v-for="win in windows"
          :key="win.id"
          :title="win.title"
          :icon="win.icon"
          :icon-color="win.iconColor"
          :icon-bg="win.iconBg"
          :x="win.x"
          :y="win.y"
          :width="win.width"
          :height="win.height"
          :z-index="win.zIndex"
          :minimized="win.minimized"
          :maximized="win.maximized"
          :focused="focusedId === win.id"
          :mobile="isMobile"
          @close="closeWindow(win.id)"
          @focus="focusWindow(win.id)"
          @minimize="minimizeWindow(win.id)"
          @toggle-maximize="onToggleMaximize(win.id)"
          @update:bounds="updateBounds(win.id, $event)"
        >
          <component
            :is="appComponents[win.appId]"
            v-bind="windowProps(win)"
            @close="closeWindow(win.id)"
            @open-files="onOpenFiles"
          />
        </FloatingWindow>
      </div>

      <WindowTaskbar
        :windows="windows"
        :focused-id="focusedId"
        @activate="onTaskbarActivate"
        @close="closeWindow"
      />
    </div>
  </div>
</template>

<style scoped>
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
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 1rem 1rem 5rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.windows-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.windows-layer :deep(.floating-window) {
  pointer-events: auto;
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

.has-wallpaper .app-tile:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(6px);
}

.has-wallpaper .app-tile-selected {
  background: rgba(219, 234, 254, 0.45);
  border-color: rgba(59, 130, 246, 0.5);
  backdrop-filter: blur(6px);
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

.has-wallpaper .app-tile-label {
  color: #fff;
  text-shadow:
    0 1px 3px rgba(0, 0, 0, 0.8),
    0 0 8px rgba(0, 0, 0, 0.6);
}
</style>
