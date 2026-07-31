<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, markRaw, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { type Session } from 'xconn'

import { useMachinesStore } from '@/stores/machines'
import { useSettingsStore } from '@/stores/settings'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import EmbeddedDesktopFiles from '@/components/EmbeddedDesktopFiles.vue'
import EmbeddedIndexedFiles from '@/components/EmbeddedIndexedFiles.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import ResourceMonitor from '@/components/ResourceMonitor.vue'
import DesktopSettingsPanel from '@/components/DesktopSettingsPanel.vue'
import FilePreviewModal from '@/components/FilePreviewModal.vue'
import TextEditor from '@/components/TextEditor.vue'
import ScreenshotPanel from '@/components/ScreenshotPanel.vue'
import FloatingWindow from '@/components/FloatingWindow.vue'
import AppDock from '@/components/AppDock.vue'
import DownloadToast from '@/components/DownloadToast.vue'
import { loadCachedWallpaper, storeWallpaper } from '@/composables/useWallpaperCache'
import { getFilePreviewType, type FilePreviewType } from '@/utils/fileTypes'
import { downloadFile, type DownloadProgressState } from '@/utils/fileDownload'

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
  closeAll,
  focusWindow,
  minimizeWindow,
  restoreWindow,
  toggleMaximize,
  updateBounds,
  updateTitle,
  updateDirty,
  syncMaximizedBounds,
} = desktopSessionsStore.getOrCreate(props.realm)

const sessionTitle = computed(() => {
  const focused = windows.value.find((w) => w.id === focusedId.value)
  return focused
    ? `${focused.title} · ${desktopName.value} - Deskconn`
    : `${desktopName.value} - Deskconn`
})

// Only the active realm's instance may write document.title (others stay mounted via v-show).
watch(
  [sessionTitle, () => props.active],
  ([title, active]) => {
    if (active) document.title = title
  },
  { immediate: true },
)

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

// Set whenever there's no live session — the initial connect failed (e.g.
// the machine is offline) or a previously-live session dropped mid-use
// (session.onDisconnect() already fires for that today). Both cases get the
// same full-screen treatment.
const isDisconnected = ref(false)

// Apps stay open (blurred) behind the overlay while disconnected — only
// cleared once the user actually navigates away (see the active-prop watch
// below), so returning to a still-active view doesn't lose anything.
function markDisconnected() {
  isDisconnected.value = true
}

// Acquires a session and confirms deskconnd is actually reachable (a WAMP
// session can connect fine even when the machine itself is offline), then
// arms the disconnect listener for the rest of its lifetime.
async function connectSession(): Promise<boolean> {
  try {
    const session = await sessionCacheStore.acquire(props.realm)
    if (!session) return false
    await session.call('io.xconn.deskconn.deskconnd.ping')
    session.onDisconnect(async () => {
      markDisconnected()
    })
    return true
  } catch {
    return false
  }
}

// No upfront invalidate here, acquire() reuses a still-healthy cached
// session; a dead one has already evicted itself by this point.
async function connect() {
  isDisconnected.value = false
  isConnecting.value = true
  sessionCacheStore.clearUnreachable(props.realm)

  const connected = await connectSession()
  isConnecting.value = false
  if (!connected) markDisconnected()

  // Otherwise the stale session gets reused next time, stuck on whatever
  // fallback transport it originally connected with.
  if (!connected) {
    sessionCacheStore.invalidate(props.realm)
  }
}

// Other panels (terminal, files, ...) notice a dead desktop the moment their
// own next call fails, well before this session's onDisconnect would — so
// mirror that signal here too instead of leaving the blur to lag behind.
watch(
  () => sessionCacheStore.unreachableRealms.has(props.realm),
  (unreachable) => {
    if (unreachable) markDisconnected()
  },
)

const isMobile = ref(window.innerWidth < 768)
function updateIsMobile() {
  isMobile.value = window.innerWidth < 768
}

// Vertical docks are awkward on narrow screens — always use the bottom dock there.
// Position is per-machine (see stores/settings.ts), set via the in-dock Settings app.
const dockPosition = computed(() => (isMobile.value ? 'bottom' : settingsStore.getDockPosition(props.realm)))
const screenshotOpen = ref(false)

interface AppDef {
  id: string
  label: string
  icon: string
  iconColor: string
  iconBg: string
  width?: number
  height?: number
  /** Floor for interactive resizing — see FloatingWindow's minWidth prop. */
  minWidth?: number
  /** False for apps that only ever appear because a window is already open
   * (see dockApps below) — there's nothing to launch blank. */
  launchable?: boolean
}

const apps: AppDef[] = [
  {
    id: 'files',
    label: 'Files',
    icon: 'bi-folder2-open',
    iconColor: '#2563eb',
    iconBg: '#dbeafe',
    // Its titlebar toolbar (6 buttons + breadcrumb/search) can't compress
    // past this without overlapping the minimize/maximize/close controls.
    minWidth: 460,
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
    icon: 'bi-speedometer2',
    iconColor: '#0891b2',
    iconBg: '#cffafe',
    width: 700,
    height: 560,
  },
  {
    id: 'screenshot',
    label: 'Screenshot',
    icon: 'bi-camera',
    iconColor: '#0891b2',
    iconBg: '#cffafe',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'bi-gear',
    iconColor: '#475569',
    iconBg: '#e2e8f0',
  },
]

// Not pinned in the dock's launcher strip — these only show up (via dockApps
// below) once an image/video is actually open, purely as an instance switcher.
const imageViewerApp: AppDef = {
  id: 'image-viewer',
  label: 'Image Viewer',
  icon: 'bi-image-fill',
  iconColor: '#ec4899',
  iconBg: '#fce7f3',
  launchable: false,
}

const videoPlayerApp: AppDef = {
  id: 'video-player',
  label: 'Video Player',
  icon: 'bi-file-earmark-play-fill',
  iconColor: '#7c3aed',
  iconBg: '#ede9fe',
  launchable: false,
}

const textEditorApp: AppDef = {
  id: 'text-editor',
  label: 'Text Editor',
  icon: 'bi-file-earmark-text-fill',
  iconColor: '#0f766e',
  iconBg: '#ccfbf1',
  launchable: false,
}

const dockApps = computed(() => {
  const list = [...apps]
  if (windows.value.some((w) => w.appId === 'image-viewer')) list.push(imageViewerApp)
  if (windows.value.some((w) => w.appId === 'video-player')) list.push(videoPlayerApp)
  if (windows.value.some((w) => w.appId === 'text-editor')) list.push(textEditorApp)
  return list
})

function launchApp(app: AppDef, initialPath?: string) {
  if (app.id === 'screenshot') {
    screenshotOpen.value = true
    return
  }

  openWindow({
    appId: app.id,
    title: app.label,
    icon: app.icon,
    iconColor: app.iconColor,
    iconBg: app.iconBg,
    width: app.width,
    height: app.height,
    minWidth: app.minWidth,
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
  preview: FilePreviewModal,
  'image-viewer': FilePreviewModal,
  'video-player': FilePreviewModal,
  'text-editor': TextEditor,
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
    case 'preview':
    case 'image-viewer':
    case 'video-player':
      return {
        session: win.props.session as Session,
        realm: props.realm,
        entry: win.props.entry as PreviewEntry,
        entries: win.props.entries as PreviewEntry[],
        focused,
      }
    case 'text-editor':
      return {
        session: win.props.session as Session,
        realm: props.realm,
        entry: win.props.entry as PreviewEntry,
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

type PreviewEntry = { path: string; name: string; size: number }

const PREVIEW_ICONS: Record<FilePreviewType, string> = {
  image: 'bi-image-fill',
  video: 'bi-file-earmark-play-fill',
  audio: 'bi-file-earmark-music-fill',
  pdf: 'bi-file-earmark-pdf-fill',
  text: 'bi-file-earmark-text-fill',
  none: 'bi-file-earmark-fill',
}

const downloadProgress = ref<DownloadProgressState | null>(null)

// No previewer for these — skip the blank window and download straight away.
function onPreviewFile(session: Session, entry: PreviewEntry, entries: PreviewEntry[]) {
  const pt = getFilePreviewType(entry.name)
  if (pt === 'none') {
    downloadFile(session, entry, downloadProgress)
    return
  }

  const appId = pt === 'image' ? 'image-viewer' : pt === 'video' ? 'video-player' : pt === 'text' ? 'text-editor' : 'preview'
  openWindow({
    appId,
    title: entry.name,
    icon: PREVIEW_ICONS[pt],
    iconColor: '#334155',
    iconBg: '#e2e8f0',
    width: 760,
    height: 560,
    props: { session: markRaw(session), entry, entries },
  }, maximizedContainerSize())
}

function onOpenFiles(path: string) {
  const filesApp = apps.find((a) => a.id === 'files')!
  launchApp(filesApp, path)
}

function onCloseWindow(id: string) {
  const win = windows.value.find((w) => w.id === id)
  if (win?.dirty && !window.confirm('You have unsaved changes. Close this window anyway?')) return
  closeWindow(id)
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
  if (isDisconnected.value) return
  const app = apps.find((a) => a.id === appId)
  if (app) launchApp(app)
}

// App.vue keeps one DesktopSessionHost per realm mounted forever (v-show, not
// v-if) so navigating to the dashboard and back never remounts this component
// — onMounted's connect() never reruns on its own. Without this, a desktop
// left disconnected just keeps showing the same stale blur/overlay every time
// you come back to it instead of trying again.
watch(() => props.active, (active) => {
  if (active) {
    syncMaximizedBounds(maximizedContainerSize())
    if (isDisconnected.value && !isConnecting.value) connect()
    return
  }

  // Leaving a disconnected desktop (Dashboard button, browser back, closing
  // the tab) discards its stale windows so the next visit starts fresh —
  // while still connected, navigating away/back is expected to keep them.
  if (isDisconnected.value) closeAll()
})

watch(dockPosition, async () => {
  await nextTick()
  measureDockThickness()
  syncMaximizedBounds(maximizedContainerSize())
})

let launcherBodyResizeObserver: ResizeObserver | null = null

onMounted(() => {
  window.addEventListener('resize', updateIsMobile)
  connect()
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
  window.removeEventListener('resize', updateIsMobile)
  launcherBodyResizeObserver?.disconnect()
  if (activeWallpaperObjUrl) URL.revokeObjectURL(activeWallpaperObjUrl)
})
</script>

<template>
  <div class="launcher-wrapper fade-in-up" @contextmenu.prevent>
    <div
      ref="launcherBodyRef"
      class="launcher-body"
      :class="{ 'has-wallpaper': !!wallpaperUrl, 'is-connecting': isConnecting, 'is-disconnected': isDisconnected }"
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
          :min-width="win.minWidth"
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
          @close="onCloseWindow(win.id)"
          @focus="focusWindow(win.id)"
          @minimize="minimizeWindow(win.id)"
          @toggle-maximize="onToggleMaximize(win.id)"
          @update:bounds="updateBounds(win.id, $event)"
        >
          <component
            :is="appComponents[win.appId]"
            v-bind="windowProps(win)"
            @close="onCloseWindow(win.id)"
            @open-files="onOpenFiles"
            @preview-file="onPreviewFile"
            @update-title="updateTitle(win.id, $event)"
            @dirty-change="updateDirty(win.id, $event)"
          />
        </FloatingWindow>
      </div>

      <AppDock
        :realm="realm"
        :apps="dockApps"
        :windows="windows"
        :focused-id="focusedId"
        :position="dockPosition"
        :offline="isDisconnected"
        @launch="handleLaunch"
        @activate="onActivateWindow"
        @close="onCloseWindow"
        @exit="close"
      />
    </div>

    <ScreenshotPanel v-if="screenshotOpen" :realm="realm" @close="screenshotOpen = false" />

    <DownloadToast v-if="downloadProgress" :progress="downloadProgress" />

    <div v-if="isConnecting" class="connecting-overlay">
      <div class="connecting-spinner"></div>
      <p>Connecting to {{ desktopName }}…</p>
    </div>

    <div v-if="isDisconnected" class="disconnected-overlay">
      <i class="bi bi-wifi-off"></i>
      <p>Can't connect to {{ desktopName }}.</p>
      <button type="button" class="overlay-btn" @click="close">Dashboard</button>
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

.launcher-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background-color: #000;
  transition: filter 0.2s ease;
}

.launcher-body.is-connecting {
  filter: blur(6px);
  pointer-events: none;
}

.launcher-body.is-disconnected {
  filter: grayscale(1) brightness(0.65);
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

.disconnected-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #f1f5f9;
  font-weight: 600;
  text-align: center;
  padding: 1rem;
}

.disconnected-overlay i {
  font-size: 1.75rem;
}

.overlay-btn {
  margin-top: 0.25rem;
  padding: 0.4rem 1.1rem;
  border: 1px solid rgba(241, 245, 249, 0.4);
  border-radius: 0.4rem;
  background: rgba(15, 23, 42, 0.5);
  color: #f1f5f9;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  pointer-events: auto;
}

.overlay-btn:hover {
  background: rgba(15, 23, 42, 0.75);
}
</style>
