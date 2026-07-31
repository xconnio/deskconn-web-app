<script setup lang="ts">
import { provide, ref, onMounted, onUnmounted, nextTick } from 'vue'
import { floatingWindowToolbarKey, floatingWindowActionsKey } from '@/composables/floatingWindowToolbar'

const rootEl = ref<HTMLElement | null>(null)
const toolbarHostEl = ref<HTMLElement | null>(null)
const actionsHostEl = ref<HTMLElement | null>(null)
provide(floatingWindowToolbarKey, toolbarHostEl)
provide(floatingWindowActionsKey, actionsHostEl)

const props = defineProps<{
  title: string
  icon: string
  iconColor?: string
  iconBg?: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  focused: boolean
  mobile: boolean
  insetLeft?: number
  insetRight?: number
  insetBottom?: number
  /** Let the embedded app render its own toolbar in place of the icon + title (see floatingWindowToolbar.ts). */
  useToolbarTitlebar?: boolean
  /** Dark titlebar background, for apps with a dark embedded toolbar (e.g. the terminal's tab bar). */
  darkTitlebar?: boolean
}>()

const emit = defineEmits<{
  close: []
  focus: []
  minimize: []
  'toggle-maximize': []
  'update:bounds': [bounds: { x?: number; y?: number; width?: number; height?: number }]
}>()

const MIN_WIDTH = 280
const MIN_HEIGHT = 200

// Bounds changes from dragging/resizing are continuous and must track the
// pointer exactly — the maximize/minimize transition would only make them lag.
const interacting = ref(false)

const menuOpen = ref(false)
const menuBtnRef = ref<HTMLElement | null>(null)
const menuDropdownRef = ref<HTMLElement | null>(null)

// True fullscreen (Fullscreen API) covers the whole physical screen, including
// the browser's own chrome — not just "maximized", which stays within the page.
const isFullscreen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function captureRect(): DOMRect | null {
  return rootEl.value?.getBoundingClientRect() ?? null
}

// GNOME/Ubuntu-style morph: left/top/width/height never transition directly —
// animating those forces the browser to reflow every frame, which is what
// made maximize/fullscreen look jerky, especially over heavy embedded content
// like the terminal. Instead, bounds snap instantly, and the in-between
// motion is faked with a transform (translate + scale) computed from the old
// rect — transform is compositor-only, so it stays smooth regardless of
// what's inside the window, the same trick Mutter/GNOME's own effects use.
function playFlip(before: DOMRect) {
  const el = rootEl.value
  if (!el || !before.width || !before.height) return
  requestAnimationFrame(() => {
    const after = el.getBoundingClientRect()
    if (!after.width || !after.height) return
    const dx = before.left - after.left
    const dy = before.top - after.top
    const sx = before.width / after.width
    const sy = before.height / after.height
    el.style.transition = 'none'
    el.style.transformOrigin = 'top left'
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
    requestAnimationFrame(() => {
      el.style.transition = ''
      el.style.transform = ''
    })
  })
}

async function toggleFullscreen() {
  menuOpen.value = false
  if (document.fullscreenElement === rootEl.value) {
    await document.exitFullscreen()
  } else {
    await rootEl.value?.requestFullscreen?.()
  }
}

// Covers Esc too (exits fullscreen without going through toggleFullscreen) —
// the rect is captured synchronously, before isFullscreen flips, so it holds
// whichever state (fullscreen or windowed) is about to be left.
function onFullscreenChange() {
  const before = captureRect()
  isFullscreen.value = document.fullscreenElement === rootEl.value
  nextTick(() => { if (before) playFlip(before) })
}

// Minimizing/maximizing while fullscreen would be invisible — the Fullscreen
// API only ever paints the fullscreen element's own subtree, so an opacity-0
// (minimized) or resized-but-still-fullscreen (maximized) window would just
// look like the screen went blank with no way back. Drop out of fullscreen
// first so the action is actually visible.
async function requestMinimize() {
  if (isFullscreen.value) await document.exitFullscreen()
  emit('minimize')
}

async function requestToggleMaximize() {
  if (isFullscreen.value) await document.exitFullscreen()
  const before = captureRect()
  emit('toggle-maximize')
  await nextTick()
  if (before) playFlip(before)
}

function onWindowClickForMenu(e: MouseEvent) {
  if (!menuOpen.value) return
  const target = e.target as Node
  if (menuBtnRef.value?.contains(target)) return
  if (menuDropdownRef.value?.contains(target)) return
  menuOpen.value = false
}

// Clicks inside an <iframe> (e.g. the PDF preview) never bubble a pointerdown
// here, since it's a separate browsing context — but focusing it does blur
// the top-level window, so use that as a fallback focus signal.
function onWindowBlur() {
  setTimeout(() => {
    if (document.activeElement instanceof HTMLIFrameElement && rootEl.value?.contains(document.activeElement)) {
      emit('focus')
    }
  }, 0)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('click', onWindowClickForMenu, true)
  window.addEventListener('blur', onWindowBlur)
})
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('click', onWindowClickForMenu, true)
  window.removeEventListener('blur', onWindowBlur)
})

function suppressSelection() {
  document.body.style.userSelect = 'none'
}

function restoreSelection() {
  document.body.style.userSelect = ''
}

function startDrag(e: PointerEvent) {
  const target = e.target as HTMLElement
  // Only interactive elements (buttons, inputs) opt out of dragging.
  if (target.closest('.fwin-controls, button, input')) return
  // Titlebar isn't a focusable element, but the browser's default pointerdown
  // action still shifts focus to it (blurring whatever had it, e.g. the terminal).
  e.preventDefault()
  if (props.mobile || props.maximized || isFullscreen.value) return

  emit('focus')

  const startX = e.clientX
  const startY = e.clientY
  const originX = props.x
  const originY = props.y
  const container = rootEl.value?.parentElement

  suppressSelection()
  interacting.value = true

  function onMove(ev: PointerEvent) {
    let x = originX + (ev.clientX - startX)
    let y = originY + (ev.clientY - startY)

    if (container) {
      const minX = props.insetLeft ?? 0
      const maxX = Math.max(minX, container.clientWidth - (props.insetRight ?? 0) - props.width)
      const maxY = Math.max(0, container.clientHeight - (props.insetBottom ?? 0) - props.height)
      x = Math.min(Math.max(x, minX), maxX)
      y = Math.min(Math.max(y, 0), maxY)
    }

    emit('update:bounds', { x, y })
  }

  function onUp() {
    restoreSelection()
    interacting.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onTitlebarDoubleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.fwin-controls, button, input')) return
  if (props.mobile || isFullscreen.value) return
  void requestToggleMaximize()
}

function startResize(e: PointerEvent, dir: string) {
  if (props.mobile || props.maximized || isFullscreen.value) return
  e.stopPropagation()
  emit('focus')

  const startX = e.clientX
  const startY = e.clientY
  const originX = props.x
  const originY = props.y
  const originW = props.width
  const originH = props.height
  const container = rootEl.value?.parentElement

  suppressSelection()
  interacting.value = true

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    const bounds: { x?: number; y?: number; width?: number; height?: number } = {}

    if (dir.includes('e')) {
      let width = Math.max(MIN_WIDTH, originW + dx)
      if (container) width = Math.min(width, container.clientWidth - (props.insetRight ?? 0) - originX)
      bounds.width = width
    }
    if (dir.includes('s')) {
      let height = Math.max(MIN_HEIGHT, originH + dy)
      if (container) height = Math.min(height, container.clientHeight - (props.insetBottom ?? 0) - originY)
      bounds.height = height
    }
    if (dir.includes('w')) {
      let width = Math.max(MIN_WIDTH, originW - dx)
      let x = originX + (originW - width)
      const minX = props.insetLeft ?? 0
      if (x < minX) {
        x = minX
        width = originX + originW - minX
      }
      bounds.width = width
      bounds.x = x
    }
    if (dir.includes('n')) {
      let height = Math.max(MIN_HEIGHT, originH - dy)
      let y = originY + (originH - height)
      if (y < 0) {
        y = 0
        height = originY + originH
      }
      bounds.height = height
      bounds.y = y
    }

    emit('update:bounds', bounds)
  }

  function onUp() {
    restoreSelection()
    interacting.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div
    ref="rootEl"
    class="floating-window"
    :class="{ 'is-mobile': mobile, 'is-focused': focused, 'is-minimized': minimized, 'is-maximized': maximized, 'is-dark-titlebar': darkTitlebar, 'is-interacting': interacting, 'is-fullscreen': isFullscreen }"
    :inert="minimized"
    :style="mobile ? { zIndex } : {
      left: x + 'px',
      top: y + 'px',
      width: width + 'px',
      height: height + 'px',
      zIndex,
    }"
    @pointerdown="$emit('focus')"
  >
    <div class="fwin-titlebar" :class="{ 'fwin-titlebar--dark': darkTitlebar }" @pointerdown="startDrag" @dblclick="onTitlebarDoubleClick" @contextmenu.prevent>
      <template v-if="!useToolbarTitlebar">
        <span class="fwin-icon" :style="{ color: iconColor, background: iconBg }">
          <i class="bi" :class="icon"></i>
        </span>
        <span class="fwin-title">{{ title }}</span>
      </template>
      <div
        ref="toolbarHostEl"
        class="fwin-toolbar-host"
        :class="{ 'fwin-toolbar-host--active': useToolbarTitlebar }"
      ></div>
      <div ref="actionsHostEl" class="fwin-actions-host"></div>
      <div class="fwin-controls">
        <button ref="menuBtnRef" class="fwin-btn" title="Menu" @mousedown.prevent @click.stop="toggleMenu">
          <i class="bi bi-list"></i>
        </button>
        <button class="fwin-btn" title="Minimize" @mousedown.prevent @click="requestMinimize">
          <i class="bi bi-dash-lg"></i>
        </button>
        <button v-if="!mobile" class="fwin-btn" :title="maximized ? 'Restore' : 'Maximize'" @mousedown.prevent @click="requestToggleMaximize">
          <i class="bi" :class="maximized ? 'bi-copy' : 'bi-square'"></i>
        </button>
        <button class="fwin-btn fwin-btn-close" title="Close" @mousedown.prevent @click="$emit('close')">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <!-- A plain descendant of .floating-window, not teleported: while this
           window is the Fullscreen API's fullscreen element, the browser only
           paints that element's own subtree, so anything teleported to
           <body> (a sibling, not a descendant) would be invisible/unclickable. -->
      <div v-if="menuOpen" ref="menuDropdownRef" class="fwin-menu" @click.stop>
        <button class="fwin-menu-item" @click="toggleFullscreen">
          <i class="bi" :class="isFullscreen ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'"></i>
          {{ isFullscreen ? 'Exit full screen' : 'Full screen' }}
        </button>
      </div>
    </div>

    <div class="fwin-body">
      <slot />
    </div>

    <template v-if="!mobile && !maximized && !isFullscreen">
      <div class="fwin-resize fwin-resize-n" @pointerdown="startResize($event, 'n')"></div>
      <div class="fwin-resize fwin-resize-s" @pointerdown="startResize($event, 's')"></div>
      <div class="fwin-resize fwin-resize-e" @pointerdown="startResize($event, 'e')"></div>
      <div class="fwin-resize fwin-resize-w" @pointerdown="startResize($event, 'w')"></div>
      <div class="fwin-resize fwin-resize-ne" @pointerdown="startResize($event, 'ne')"></div>
      <div class="fwin-resize fwin-resize-nw" @pointerdown="startResize($event, 'nw')"></div>
      <div class="fwin-resize fwin-resize-se" @pointerdown="startResize($event, 'se')"></div>
      <div class="fwin-resize fwin-resize-sw" @pointerdown="startResize($event, 'sw')"></div>
    </template>
  </div>
</template>

<style scoped>
.floating-window {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  overflow: hidden;
  min-width: 280px;
  min-height: 200px;
  /* left/top/width/height are never transitioned — animating those forces a
     browser reflow every frame (the source of the maximize/fullscreen jerk).
     The morph is faked with transform instead — see playFlip. */
  transition: opacity 0.15s ease, transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* Dragging/resizing must track the pointer exactly — a transition here would lag. */
.floating-window.is-interacting {
  transition: none;
}

.floating-window.is-maximized,
.floating-window.is-mobile {
  border-radius: 0;
}

.floating-window.is-dark-titlebar {
  border-color: #242424;
}

.floating-window.is-minimized {
  opacity: 0;
  transform: scale(0.85);
  pointer-events: none !important;
}

.floating-window.is-focused {
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
  border-color: #cbd5e1;
}

.floating-window.is-dark-titlebar.is-focused {
  border-color: #242424;
}

.floating-window.is-mobile {
  position: fixed;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  border: none;
}

/* Fullscreen API renders this element with no other page content around it,
   but doesn't itself resize the box — it keeps whatever x/y/width/height it
   already had (maximized, floating, or mobile), so pin it to the screen. */
.floating-window.is-fullscreen {
  position: fixed !important;
  inset: 0 !important;
  left: 0 !important;
  top: 0 !important;
  width: 100% !important;
  height: 100% !important;
  border: none;
  border-radius: 0;
}

.fwin-titlebar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.6rem;
  background: #fff;
  flex-shrink: 0;
  user-select: none;
}

.floating-window:not(.is-focused) .fwin-titlebar {
  background: #eef1f4;
}

.fwin-titlebar--dark {
  background: linear-gradient(#3c3c3c, #333333);
  border-bottom: 1px solid #1a1a1a;
}

.floating-window:not(.is-focused) .fwin-titlebar--dark {
  background: #242424;
}

/* Ubuntu-style window controls: grey circle, white icon, subtle bevel. */
.fwin-titlebar--dark .fwin-btn {
  background: linear-gradient(#565656, #454545);
  border-color: #3a3a3a;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 1px rgba(0, 0, 0, 0.3);
}

.fwin-titlebar--dark .fwin-btn:hover {
  background: linear-gradient(#686868, #565656);
  border-color: #444;
  color: #fff;
}

.fwin-titlebar--dark .fwin-btn-close:hover {
  background: #e01b24;
  border-color: #e01b24;
  color: #fff;
}

.floating-window:not(.is-focused) .fwin-title {
  color: #94a3b8;
}

.floating-window:not(.is-focused) .fwin-icon {
  filter: grayscale(60%);
  opacity: 0.6;
}

.fwin-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.fwin-title {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.fwin-toolbar-host {
  display: none;
}

.fwin-toolbar-host--active {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  cursor: default;
}

.fwin-actions-host {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.fwin-actions-host:empty {
  display: none;
}

.fwin-controls {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.fwin-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid #d9dee4;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  font-size: 0.6rem;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.fwin-btn:hover {
  background: #e2e8f0;
  color: #111827;
}

/* Teleported to <body> and positioned via an inline style computed from the
   menu button's rect (see toggleMenu) — the same clipping concern as any
   popover nested inside this window's overflow:hidden box. */
.fwin-menu {
  position: absolute;
  top: 100%;
  right: 0.6rem;
  margin-top: 4px;
  min-width: 170px;
  padding: 0.3rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  z-index: 20;
}

.fwin-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  text-align: left;
}

.fwin-menu-item:hover {
  background: #eef2f6;
}

.fwin-btn-close:hover {
  background: #fee2e2;
  color: #dc2626;
}

.fwin-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.fwin-resize {
  position: absolute;
  z-index: 2;
}

.fwin-resize-n,
.fwin-resize-s {
  left: 10px;
  right: 10px;
  height: 6px;
  cursor: ns-resize;
}

.fwin-resize-n { top: -3px; }
.fwin-resize-s { bottom: -3px; }

.fwin-resize-e,
.fwin-resize-w {
  top: 10px;
  bottom: 10px;
  width: 6px;
  cursor: ew-resize;
}

.fwin-resize-e { right: -3px; }
.fwin-resize-w { left: -3px; }

.fwin-resize-ne,
.fwin-resize-nw,
.fwin-resize-se,
.fwin-resize-sw {
  width: 14px;
  height: 14px;
}

.fwin-resize-ne { top: -3px; right: -3px; cursor: nesw-resize; }
.fwin-resize-nw { top: -3px; left: -3px; cursor: nwse-resize; }
.fwin-resize-se { bottom: -3px; right: -3px; cursor: nwse-resize; }
.fwin-resize-sw { bottom: -3px; left: -3px; cursor: nesw-resize; }
</style>
