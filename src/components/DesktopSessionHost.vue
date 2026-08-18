<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick, markRaw, type Component } from 'vue'
import { type Session } from 'xconn'
import type { FileEntry } from '@/types'
import { requestMachinesPicker } from '@/router/index'
import type { AppWindow } from '@/composables/useWindowManager'

import { useMachinesStore } from '@/stores/machines'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import { useMachinesOverviewStore, PREVIEW_WIDTH, PREVIEW_HEIGHT } from '@/stores/machinesOverview'
import { useWindowsOverviewStore, WINDOW_PREVIEW_WIDTH, WINDOW_PREVIEW_HEIGHT } from '@/stores/windowsOverview'
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

const machinesStore = useMachinesStore()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const sessionCacheStore = useSessionCacheStore()
const desktopSessionsStore = useDesktopSessionsStore()
const machinesOverviewStore = useMachinesOverviewStore()
const windowsOverviewStore = useWindowsOverviewStore()

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

// Frozen at the last real size — a backgrounded instance is display:none and reads 0.
const lastKnownSize = ref({ width: 0, height: 0 })

function captureContainerSize() {
  const el = launcherBodyRef.value
  if (!el || !el.clientWidth) return
  lastKnownSize.value = { width: el.clientWidth, height: el.clientHeight }
}

const previewTarget = computed(() => machinesOverviewStore.previewTargets[props.realm])

const previewScale = computed(() => {
  const { width, height } = lastKnownSize.value
  if (!previewTarget.value || !width || !height) return null
  return { scaleX: PREVIEW_WIDTH / width, scaleY: PREVIEW_HEIGHT / height, width, height }
})

const launcherBodyStyle = computed(() => {
  const style: Record<string, string> = wallpaperUrl.value
    ? { backgroundImage: `url(${wallpaperUrl.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
  const scale = previewScale.value
  if (!scale) return style
  return {
    ...style,
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${scale.width}px`,
    height: `${scale.height}px`,
    transform: `scale(${scale.scaleX}, ${scale.scaleY})`,
    transformOrigin: 'top left',
    pointerEvents: 'none',
  }
})

// Same scale-in-place technique as the machine-level preview above, but per
// window — the teleported content keeps its real pixel size (so nothing
// reflows) and is just visually shrunk to fit AppDock's overview tile.
function windowPreviewTarget(windowId: string): HTMLElement | undefined {
  return windowsOverviewStore.previewTargets[windowId]
}

function windowPreviewStyle(win: AppWindow): Record<string, string> {
  return {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${win.width}px`,
    height: `${win.height}px`,
    transform: `scale(${WINDOW_PREVIEW_WIDTH / win.width}, ${WINDOW_PREVIEW_HEIGHT / win.height})`,
    transformOrigin: 'top left',
    pointerEvents: 'none',
  }
}

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

  // Own throwaway session, deliberately not the shared/cached one: wallpaper.get can
  // return a multi-MB image that exceeds the transport's single-frame size limit, which
  // kills the whole stream it was sent on. Isolating it here means that failure can only
  // cost the wallpaper, not the desktop session everything else (terminal, files, ping) relies on.
  let session: Session | false | null = null
  try {
    session = await authStore.shellWamp(props.realm)
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
  } finally {
    if (session) session.leave().catch(() => {})
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
    iconColor: '#ffffff',
    iconBg: '#2563eb',
    // Its titlebar toolbar (6 buttons + breadcrumb/search) can't compress
    // past this without overlapping the minimize/maximize/close controls.
    minWidth: 460,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: 'bi-terminal',
    iconColor: '#ffffff',
    iconBg: '#1e293b',
    width: 640,
    height: 420,
  },
  {
    id: 'pictures',
    label: 'Pictures',
    icon: 'bi-images',
    iconColor: '#ffffff',
    iconBg: '#db2777',
  },
  {
    id: 'videos',
    label: 'Videos',
    icon: 'bi-collection-play',
    iconColor: '#ffffff',
    iconBg: '#7c3aed',
  },
  {
    id: 'documents',
    label: 'Documents',
    icon: 'bi-file-earmark-richtext',
    iconColor: '#ffffff',
    iconBg: '#d97706',
  },
  {
    id: 'resource-monitor',
    label: 'Resource Monitor',
    icon: 'bi-speedometer',
    iconColor: '#ffffff',
    iconBg: '#0d9488',
    width: 700,
    height: 560,
  },
  {
    id: 'screenshot',
    label: 'Screenshot',
    icon: 'bi-camera',
    iconColor: '#ffffff',
    iconBg: '#4f46e5',
    width: 760,
    height: 560,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'bi-gear',
    iconColor: '#ffffff',
    iconBg: '#475569',
  },
  {
    id: 'text-editor',
    label: 'Text Editor',
    icon: 'bi-file-earmark-richtext',
    iconColor: '#ffffff',
    iconBg: '#0f766e',
    width: 820,
    height: 560,
    minWidth: 420,
  },
]

// Not pinned in the dock's launcher strip — these only show up (via dockApps
// below) once an image/video is actually open, purely as an instance switcher.
const imageViewerApp: AppDef = {
  id: 'image-viewer',
  label: 'Image Viewer',
  icon: 'bi-image',
  iconColor: '#ffffff',
  iconBg: '#db2777',
  launchable: false,
}

const videoPlayerApp: AppDef = {
  id: 'video-player',
  label: 'Video Player',
  icon: 'bi-collection-play',
  iconColor: '#ffffff',
  iconBg: '#7c3aed',
  launchable: false,
}

const dockApps = computed(() => {
  const list = [...apps]
  if (windows.value.some((w) => w.appId === 'image-viewer')) list.push(imageViewerApp)
  if (windows.value.some((w) => w.appId === 'video-player')) list.push(videoPlayerApp)
  return list
})

function launchApp(app: AppDef, initialPath?: string) {
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
  screenshot: ScreenshotPanel,
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
    case 'screenshot':
      return {
        realm: props.realm,
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
        session: win.props.session as Session | undefined,
        realm: props.realm,
        entry: win.props.entry as PreviewEntry | undefined,
        initialFolder: win.props.initialFolder as string | undefined,
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

const PREVIEW_STYLE: Record<FilePreviewType, { icon: string; color: string; bg: string }> = {
  image: { icon: imageViewerApp.icon, color: imageViewerApp.iconColor, bg: imageViewerApp.iconBg },
  video: { icon: videoPlayerApp.icon, color: videoPlayerApp.iconColor, bg: videoPlayerApp.iconBg },
  text: { icon: 'bi-file-earmark-richtext', color: '#ffffff', bg: '#0f766e' },
  audio: { icon: 'bi-file-earmark-music', color: '#ffffff', bg: '#e11d48' },
  pdf: { icon: 'bi-file-earmark-pdf', color: '#ffffff', bg: '#dc2626' },
  none: { icon: 'bi-file-earmark', color: '#ffffff', bg: '#475569' },
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
  const style = PREVIEW_STYLE[pt]
  openWindow({
    appId,
    title: entry.name,
    icon: style.icon,
    iconColor: style.color,
    iconBg: style.bg,
    width: 760,
    height: 560,
    props: { session: markRaw(session), entry, entries },
  }, maximizedContainerSize())
}

// Unlike onPreviewFile, this always routes to Text Editor regardless of file
// type, and handles a folder by opening it as the editor's sidebar project
// instead of a single file tab.
function onOpenTextEditor(session: Session, entry: FileEntry) {
  const style = PREVIEW_STYLE.text
  openWindow({
    appId: 'text-editor',
    title: entry.name,
    icon: style.icon,
    iconColor: style.color,
    iconBg: style.bg,
    width: 760,
    height: 560,
    props: entry.is_dir
      ? { session: markRaw(session), initialFolder: entry.path }
      : { session: markRaw(session), entry: { path: entry.path, name: entry.name, size: entry.size } },
  }, maximizedContainerSize())
}

function onOpenFiles(path: string) {
  const filesApp = apps.find((a) => a.id === 'files')!
  launchApp(filesApp, path)
}

// Some embedded apps (Terminal) need an async say over whether the window
// may actually close — e.g. warning before killing a running process — which
// a synchronous `dirty` flag can't express. They opt in via defineExpose.
interface CloseableWindowInstance {
  requestClose?: () => Promise<boolean>
}
const windowInstances = new Map<string, CloseableWindowInstance>()
function windowRef(id: string) {
  return (instance: unknown) => {
    if (instance) windowInstances.set(id, instance as CloseableWindowInstance)
    else windowInstances.delete(id)
  }
}

async function onCloseWindow(id: string) {
  const canClose = await windowInstances.get(id)?.requestClose?.()
  if (canClose === false) return
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
    captureContainerSize()
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
      captureContainerSize()
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
    <Teleport :to="previewTarget" :disabled="!previewTarget">
    <div
      ref="launcherBodyRef"
      class="launcher-body"
      :class="{ 'has-wallpaper': !!wallpaperUrl, 'is-connecting': isConnecting, 'is-disconnected': isDisconnected }"
      :style="launcherBodyStyle"
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
          :use-toolbar-titlebar="win.appId === 'files' || win.appId === 'terminal' || win.appId === 'text-editor'"
          :dark-titlebar="win.appId === 'terminal' || win.appId === 'text-editor'"
          :inset-left="insetLeft"
          :inset-right="insetRight"
          :inset-bottom="insetBottom"
          @close="onCloseWindow(win.id)"
          @focus="focusWindow(win.id)"
          @minimize="minimizeWindow(win.id)"
          @toggle-maximize="onToggleMaximize(win.id)"
          @update:bounds="updateBounds(win.id, $event)"
        >
          <!-- display:contents when not targeted keeps this wrapper out of
               .fwin-body's flex layout entirely, so it's a no-op box until
               the overview actually teleports it (see windowPreviewStyle). -->
          <Teleport :to="windowPreviewTarget(win.id)" :disabled="!windowPreviewTarget(win.id)">
            <div :style="windowPreviewTarget(win.id) ? windowPreviewStyle(win) : { display: 'contents' }">
              <component
                :is="appComponents[win.appId]"
                :ref="windowRef(win.id)"
                v-bind="windowProps(win)"
                @close="onCloseWindow(win.id)"
                @open-files="onOpenFiles"
                @preview-file="onPreviewFile"
                @open-text-editor="onOpenTextEditor"
                @update-title="updateTitle(win.id, $event)"
              />
            </div>
          </Teleport>
        </FloatingWindow>
      </div>

      <AppDock
        :realm="realm"
        :desktop-name="desktopName"
        :apps="dockApps"
        :windows="windows"
        :focused-id="focusedId"
        :position="dockPosition"
        :offline="isDisconnected"
        @launch="handleLaunch"
        @activate="onActivateWindow"
        @close="onCloseWindow"
      />
    </div>
    </Teleport>

    <DownloadToast v-if="downloadProgress" :progress="downloadProgress" />

    <div v-if="isConnecting" class="connecting-overlay">
      <div class="connecting-spinner"></div>
      <p>Connecting to {{ desktopName }}…</p>
    </div>

    <div v-if="isDisconnected" class="disconnected-overlay">
      <i class="bi bi-wifi-off"></i>
      <p>Can't connect to {{ desktopName }}.</p>
      <button type="button" class="overlay-btn" @click="requestMachinesPicker()">Switch Machine</button>
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
