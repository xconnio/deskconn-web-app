<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, type Component } from 'vue'
import { useRouter } from 'vue-router'

import { useMachinesStore } from '@/stores/machines'
import { useSettingsStore } from '@/stores/settings'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import EmbeddedDesktopFiles from '@/components/EmbeddedDesktopFiles.vue'
import EmbeddedIndexedFiles from '@/components/EmbeddedIndexedFiles.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import ResourceMonitor from '@/components/ResourceMonitor.vue'
import DesktopSettingsPanel from '@/components/DesktopSettingsPanel.vue'
import FloatingWindow from '@/components/FloatingWindow.vue'
import AppDock from '@/components/AppDock.vue'
import { loadCachedWallpaper, storeWallpaper } from '@/composables/useWallpaperCache'

const props = defineProps<{ realm: string; active: boolean }>()

const router = useRouter()
const machinesStore = useMachinesStore()
const settingsStore = useSettingsStore()
const sessionCacheStore = useSessionCacheStore()
const desktopSessionsStore = useDesktopSessionsStore()

const close = () => router.push('/')

const desktopName = computed(() => machinesStore.desktops.find((d) => d.realm === props.realm)?.name ?? props.realm)

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
  syncMaximizedBounds,
} = desktopSessionsStore.getOrCreate(props.realm)

const launcherBodyRef = ref<HTMLElement | null>(null)
const wallpaperUrl = ref<string | null>(null)
let activeWallpaperObjUrl: string | null = null

function applyWallpaperUrl(url: string | null) {
  if (activeWallpaperObjUrl && activeWallpaperObjUrl !== url) URL.revokeObjectURL(activeWallpaperObjUrl)
  activeWallpaperObjUrl = url
  wallpaperUrl.value = url
}

async function fetchWallpaper() {
  if (!settingsStore.useRemoteWallpaper) {
    wallpaperUrl.value = null
    return
  }

  // Show persisted wallpaper immediately without any network call
  const cached = await loadCachedWallpaper(props.realm)
  applyWallpaperUrl(cached?.url ?? null)

  try {
    const session = await sessionCacheStore.acquire(props.realm)
    if (!session) return

    // Cheap md5 check — only download the full image when it has changed
    const checksumResult = await session.call('io.xconn.deskconn.deskconnd.wallpaper.checksum')
    const remoteChecksum = checksumResult.args?.[0] as string
    if (cached?.checksum === remoteChecksum) return

    const result = await session.call('io.xconn.deskconn.deskconnd.wallpaper.get')
    const mimeType = result.args?.[0] as string
    const data = result.args?.[1] as Uint8Array
    if (!data?.length) return

    const newUrl = await storeWallpaper(props.realm, data, mimeType, remoteChecksum)
    applyWallpaperUrl(newUrl)
  } catch {
    // silently ignore — wallpaper is optional
  }
}

// Blurs the desktop until the backend session is actually up — independent
// of the wallpaper fetch above, which is opt-in via a setting and shouldn't
// gate this.
const isConnecting = ref(true)

// A WAMP session can connect fine even when the machine itself is offline;
// pinging deskconnd is what actually confirms it's reachable.
const isOffline = ref(false)

async function ensureConnected() {
  try {
    const session = await sessionCacheStore.acquire(props.realm)
    if (!session) {
      isOffline.value = true
      return
    }
    await session.call('io.xconn.deskconn.deskconnd.ping')
  } catch {
    isOffline.value = true
  } finally {
    isConnecting.value = false
  }

  // Otherwise the stale session gets reused next time, stuck on whatever
  // fallback transport it originally connected with.
  if (isOffline.value) {
    sessionCacheStore.invalidate(props.realm)
  }
}

const isMobile = ref(window.innerWidth < 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth < 768
}

// Vertical docks are awkward on narrow screens — always use the bottom dock there.
// Position is per-machine (see stores/settings.ts), set via the in-dock Settings app.
const dockPosition = computed(() => (isMobile.value ? 'bottom' : settingsStore.getDockPosition(props.realm)))

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
  {
    id: 'settings',
    label: 'Settings',
    icon: 'bi-gear',
    iconColor: '#475569',
    iconBg: '#e2e8f0',
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
  }, maximizedContainerSize())
}

const appComponents: Record<string, Component> = {
  files: EmbeddedDesktopFiles,
  terminal: TerminalPanel,
  pictures: EmbeddedIndexedFiles,
  videos: EmbeddedIndexedFiles,
  documents: EmbeddedIndexedFiles,
  'resource-monitor': ResourceMonitor,
  settings: DesktopSettingsPanel,
}

function windowProps(win: { id: string; appId: string; props: Record<string, unknown> }) {
  const focused = focusedId.value === win.id
  switch (win.appId) {
    case 'files':
      return {
        realm: props.realm,
        desktopName: desktopName.value,
        initialPath: win.props.initialPath as string | undefined,
        focused,
      }
    case 'terminal':
      return {
        realm: props.realm,
        desktopName: desktopName.value,
        embedded: true,
        focused,
      }
    case 'resource-monitor':
      return {
        realm: props.realm,
        desktopName: desktopName.value,
        focused,
      }
    case 'settings':
      return {
        realm: props.realm,
        focused,
      }
    default:
      return {
        realm: props.realm,
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

const dockThickness = ref(0)

function measureDockThickness() {
  const dockEl = launcherBodyRef.value?.querySelector<HTMLElement>('.dock')
  if (!dockEl) {
    dockThickness.value = 0
    return
  }
  dockThickness.value = dockPosition.value === 'bottom' ? dockEl.offsetHeight : dockEl.offsetWidth
}

function maximizedContainerSize() {
  const el = launcherBodyRef.value
  const cw = el?.clientWidth ?? 0
  const ch = el?.clientHeight ?? 0
  switch (dockPosition.value) {
    case 'left':
      return { x: dockThickness.value, y: 0, width: cw - dockThickness.value, height: ch }
    case 'right':
      return { x: 0, y: 0, width: cw - dockThickness.value, height: ch }
    default:
      return { x: 0, y: 0, width: cw, height: ch - dockThickness.value }
  }
}

const insetLeft = computed(() => (dockPosition.value === 'left' ? dockThickness.value : 0))
const insetRight = computed(() => (dockPosition.value === 'right' ? dockThickness.value : 0))
const insetBottom = computed(() => (dockPosition.value === 'bottom' ? dockThickness.value : 0))

function onToggleMaximize(id: string) {
  toggleMaximize(id, maximizedContainerSize())
}

function onActivateWindow(id: string) {
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

function handleLaunch(appId: string) {
  if (isOffline.value) return
  const app = apps.find((a) => a.id === appId)
  if (app) launchApp(app)
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.active) return

  if (e.key === 'Escape') {
    if (focusedId.value) {
      closeWindow(focusedId.value)
    } else {
      close()
    }
  }
}

watch(() => props.active, (active) => {
  if (active) syncMaximizedBounds(maximizedContainerSize())
})

watch(dockPosition, async () => {
  await nextTick()
  measureDockThickness()
  syncMaximizedBounds(maximizedContainerSize())
})

let launcherBodyResizeObserver: ResizeObserver | null = null

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateIsMobile)
  ensureConnected()
  fetchWallpaper()
  measureDockThickness()

  if (launcherBodyRef.value && typeof ResizeObserver !== 'undefined') {
    launcherBodyResizeObserver = new ResizeObserver(() => {
      measureDockThickness()
      syncMaximizedBounds(maximizedContainerSize())
    })
    launcherBodyResizeObserver.observe(launcherBodyRef.value)
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', updateIsMobile)
  launcherBodyResizeObserver?.disconnect()
  if (activeWallpaperObjUrl) URL.revokeObjectURL(activeWallpaperObjUrl)
})
</script>

<template>
  <div class="launcher-wrapper fade-in-up">
    <div v-if="isOffline" class="offline-banner">
      <i class="bi bi-wifi-off"></i>
      <span>{{ desktopName }} is offline — apps aren't available right now.</span>
    </div>

    <div
      ref="launcherBodyRef"
      class="launcher-body"
      :class="{ 'has-wallpaper': !!wallpaperUrl, 'is-connecting': isConnecting }"
      :style="wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
    >
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
          :use-toolbar-titlebar="win.appId === 'files' || win.appId === 'terminal'"
          :dark-titlebar="win.appId === 'terminal'"
          :inset-left="insetLeft"
          :inset-right="insetRight"
          :inset-bottom="insetBottom"
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

      <AppDock
        :realm="realm"
        :apps="apps"
        :windows="windows"
        :focused-id="focusedId"
        :position="dockPosition"
        :offline="isOffline"
        @launch="handleLaunch"
        @activate="onActivateWindow"
        @close="closeWindow"
        @exit="close"
      />
    </div>

    <div v-if="isConnecting" class="connecting-overlay">
      <div class="connecting-spinner"></div>
      <p>Connecting to {{ desktopName }}…</p>
    </div>
  </div>
</template>

<style scoped>
.launcher-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.offline-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
  background: #fef3c7;
  border-bottom: 1px solid #fbbf24;
  color: #92400e;
  font-size: 0.8rem;
  font-weight: 500;
  flex-shrink: 0;
  z-index: 60;
}

.launcher-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  transition: filter 0.2s ease;
}

.launcher-body.is-connecting {
  filter: blur(6px);
  pointer-events: none;
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

.connecting-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #334155;
  font-weight: 600;
  pointer-events: none;
}

.connecting-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(51, 65, 85, 0.2);
  border-top-color: #334155;
  border-radius: 50%;
  animation: connecting-spin 0.8s linear infinite;
}

@keyframes connecting-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
