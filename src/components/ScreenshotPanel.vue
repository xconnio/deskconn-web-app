<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ApplicationError } from 'xconn'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { formatDesktopError } from '@/utils/desktopError'

const props = defineProps<{ realm: string }>()
const emit = defineEmits<{ close: [] }>()

const sessionCacheStore = useSessionCacheStore()

const imageUrl = ref<string | null>(null)
const loading = ref(true)
const error = ref('')
const disabled = ref(false)

const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, px: 0, py: 0 })
const imgAreaRef = ref<HTMLElement | null>(null)
let pinchDist = 0
let pinchZoomStart = 1

const copied = ref(false)
async function copyCommand() {
  await navigator.clipboard.writeText('desk screenshot enable')
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

const imgTransform = computed(
  () => `scale(${zoom.value}) translate(${panX.value}px, ${panY.value}px)`,
)

function close() {
  emit('close')
}

function download() {
  if (!imageUrl.value) return
  const a = document.createElement('a')
  a.href = imageUrl.value
  a.download = `screenshot-${Date.now()}.png`
  a.click()
}

async function capture() {
  loading.value = true
  error.value = ''
  disabled.value = false
  imageUrl.value = null
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  try {
    const session = await sessionCacheStore.acquire(props.realm)
    if (!session) throw new Error('not connected')
    const result = await session.call('io.xconn.deskconn.deskconnd.screenshot')
    imageUrl.value = `data:image/png;base64,${result.args[0] as string}`
  } catch (e) {
    const detail = e instanceof ApplicationError ? (e.args?.[0] ?? '') : ''
    if (String(detail).includes('screenshot not enabled')) {
      disabled.value = true
    } else {
      error.value = formatDesktopError(e)
    }
  } finally {
    loading.value = false
  }
}

function clampZoom(z: number) {
  return Math.min(Math.max(z, 0.2), 12)
}

function fitToScreen() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function applyZoom(newZoom: number, cursorX: number, cursorY: number) {
  const el = imgAreaRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const cx = cursorX - (rect.left + rect.width / 2)
  const cy = cursorY - (rect.top + rect.height / 2)
  const oldZoom = zoom.value
  panX.value += cx * (1 / newZoom - 1 / oldZoom)
  panY.value += cy * (1 / newZoom - 1 / oldZoom)
  zoom.value = newZoom
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  applyZoom(clampZoom(zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12)), e.clientX, e.clientY)
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  dragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value }
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  panX.value = dragStart.value.px + (e.clientX - dragStart.value.x) / zoom.value
  panY.value = dragStart.value.py + (e.clientY - dragStart.value.y) / zoom.value
}

function onMouseUp() {
  dragging.value = false
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    pinchDist = Math.hypot(
      e.touches[0]!.clientX - e.touches[1]!.clientX,
      e.touches[0]!.clientY - e.touches[1]!.clientY,
    )
    pinchZoomStart = zoom.value
  } else if (e.touches.length === 1) {
    dragging.value = true
    dragStart.value = {
      x: e.touches[0]!.clientX,
      y: e.touches[0]!.clientY,
      px: panX.value,
      py: panY.value,
    }
  }
}

function onTouchMove(e: TouchEvent) {
  e.preventDefault()
  if (e.touches.length === 2) {
    const dist = Math.hypot(
      e.touches[0]!.clientX - e.touches[1]!.clientX,
      e.touches[0]!.clientY - e.touches[1]!.clientY,
    )
    zoom.value = clampZoom(pinchZoomStart * (dist / pinchDist))
  } else if (e.touches.length === 1 && dragging.value) {
    panX.value = dragStart.value.px + (e.touches[0]!.clientX - dragStart.value.x) / zoom.value
    panY.value = dragStart.value.py + (e.touches[0]!.clientY - dragStart.value.y) / zoom.value
  }
}

function onTouchEnd() {
  dragging.value = false
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  else if (e.key === '+' || e.key === '=') zoom.value = clampZoom(zoom.value * 1.2)
  else if (e.key === '-') zoom.value = clampZoom(zoom.value / 1.2)
  else if (e.key === '0') fitToScreen()
}

onMounted(() => {
  capture()
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Teleport to="body">
    <div class="sc-overlay" @click.self="close">

      <!-- Light info dialog: loading / disabled / error -->
      <div v-if="!imageUrl" class="sc-info-dialog">
        <div class="sc-info-header">
          <span class="sc-info-title">Screenshot</span>
          <button class="sc-info-close" title="Close" @click="close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="sc-info-body sc-info-loading">
          <div class="spinner-border text-secondary" role="status">
            <span class="visually-hidden">Capturing…</span>
          </div>
          <span class="sc-info-label">Capturing screenshot…</span>
        </div>

        <!-- Disabled -->
        <div v-else-if="disabled" class="sc-info-body">
          <p class="sc-info-text">Screenshots are disabled on this machine.</p>
          <p class="sc-info-sub">Run on the machine to enable:</p>
          <div class="sc-cmd-row">
            <code class="sc-cmd">desk screenshot enable</code>
            <button class="sc-copy-btn" :title="copied ? 'Copied!' : 'Copy'" @click="copyCommand">
              <i class="bi" :class="copied ? 'bi-check-lg' : 'bi-clipboard'"></i>
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="sc-info-body">
          <i class="bi bi-exclamation-triangle-fill sc-error-icon"></i>
          <p class="sc-info-text">{{ error }}</p>
        </div>

        <div class="sc-info-footer">
          <button v-if="!loading" class="sc-info-action" @click="capture">
            <i class="bi bi-arrow-clockwise"></i> Retry
          </button>
          <button class="sc-info-action sc-info-action--primary" @click="close">OK</button>
        </div>
      </div>

      <!-- Dark image viewer -->
      <div v-else class="sc-viewer">
        <div class="sc-header">
          <button class="sc-btn" title="Close (Esc)" @click="close">
            <i class="bi bi-x-lg"></i>
          </button>
          <span class="sc-title">Screenshot</span>
          <span class="sc-zoom-pct">{{ Math.round(zoom * 100) }}%</span>
          <button class="sc-btn" title="Fit (0)" @click="fitToScreen">
            <i class="bi bi-fullscreen-exit"></i>
          </button>
          <button class="sc-btn" title="Zoom in (+)" @click="zoom = clampZoom(zoom * 1.2)">
            <i class="bi bi-zoom-in"></i>
          </button>
          <button class="sc-btn" title="Zoom out (-)" @click="zoom = clampZoom(zoom / 1.2)">
            <i class="bi bi-zoom-out"></i>
          </button>
          <button class="sc-btn" title="Retake" @click="capture">
            <i class="bi bi-arrow-clockwise"></i>
          </button>
          <button class="sc-btn sc-btn-save" title="Save" @click="download">
            <i class="bi bi-download"></i>
          </button>
        </div>
        <div
          ref="imgAreaRef"
          class="sc-image-area"
          :class="{ dragging }"
          @wheel.prevent="onWheel"
          @mousedown="onMouseDown"
          @mousemove="onMouseMove"
          @mouseup="onMouseUp"
          @mouseleave="onMouseUp"
          @touchstart.prevent="onTouchStart"
          @touchmove.prevent="onTouchMove"
          @touchend="onTouchEnd"
        >
          <img
            :src="imageUrl"
            class="sc-image"
            :style="{ transform: imgTransform }"
            draggable="false"
            alt="Screenshot"
          />
        </div>
      </div>

    </div>
  </Teleport>
</template>

<style scoped>
/* ── Shared overlay ───────────────────────────── */
.sc-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

/* ── Light info dialog (loading / disabled / error) ── */
.sc-info-dialog {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  width: 100%;
  max-width: 420px;
  overflow: hidden;
}

.sc-info-header {
  display: flex;
  align-items: center;
  padding: 1.1rem 1.25rem 0.75rem;
}

.sc-info-title {
  flex: 1;
  font-size: 1rem;
  font-weight: 600;
  color: #111;
}

.sc-info-close {
  background: none;
  border: none;
  color: #999;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  line-height: 1;
}

.sc-info-close:hover {
  color: #333;
}

.sc-info-body {
  padding: 0.25rem 1.25rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sc-info-loading {
  align-items: center;
  padding-top: 1rem;
  padding-bottom: 1.5rem;
}

.sc-info-label {
  font-size: 0.85rem;
  color: #888;
}

.sc-info-text {
  margin: 0;
  font-size: 0.9rem;
  color: #333;
}

.sc-info-sub {
  margin: 0;
  font-size: 0.82rem;
  color: #777;
}

.sc-error-icon {
  font-size: 1.6rem;
  color: #ef4444;
  align-self: center;
  margin-bottom: 0.25rem;
}

.sc-info-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.5rem 1rem 1rem;
  border-top: 1px solid #f0f0f0;
}

.sc-info-action {
  background: none;
  border: none;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  color: #555;
  transition: background 0.12s;
}

.sc-info-action:hover {
  background: #f5f5f5;
}

.sc-info-action--primary {
  font-weight: 600;
  color: #2563eb;
}

.sc-info-action--primary:hover {
  background: #eff6ff;
}

/* ── Command copy row ─────────────────────────── */
.sc-cmd-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 0.45rem 0.5rem 0.45rem 0.9rem;
  border: 1px solid #e5e7eb;
}

.sc-cmd {
  flex: 1;
  font-family: monospace;
  font-size: 0.85rem;
  color: #1d4ed8;
  font-weight: 600;
  user-select: all;
}

.sc-copy-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  color: #9ca3af;
  font-size: 0.85rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: background 0.12s, color 0.12s;
}

.sc-copy-btn:hover {
  background: #e5e7eb;
  color: #374151;
}

/* ── Dark image viewer ────────────────────────── */
.sc-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 960px;
  height: 80vh;
  background: #111;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

.sc-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: 44px;
  padding: 0 0.75rem;
  background: rgba(0, 0, 0, 0.5);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.sc-title {
  flex: 1;
  font-size: 0.82rem;
  color: #888;
  padding-left: 0.25rem;
}

.sc-zoom-pct {
  font-size: 0.75rem;
  color: #555;
  min-width: 3rem;
  text-align: right;
  padding-right: 0.25rem;
}

.sc-btn {
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  color: #888;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}

.sc-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ddd;
}

.sc-btn-save {
  color: #60a5fa;
}

.sc-btn-save:hover {
  color: #93c5fd;
}

.sc-image-area {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.sc-image-area.dragging {
  cursor: grabbing;
}

.sc-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  pointer-events: none;
  border-radius: 2px;
}
</style>
