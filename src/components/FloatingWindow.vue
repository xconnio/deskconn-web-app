<script setup lang="ts">
import { provide, ref } from 'vue'
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
  if (props.mobile || props.maximized) return

  emit('focus')

  const startX = e.clientX
  const startY = e.clientY
  const originX = props.x
  const originY = props.y
  const container = rootEl.value?.parentElement

  suppressSelection()

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
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onTitlebarDoubleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.fwin-controls, button, input')) return
  if (props.mobile) return
  emit('toggle-maximize')
}

function startResize(e: PointerEvent, dir: string) {
  if (props.mobile || props.maximized) return
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
    :class="{ 'is-mobile': mobile, 'is-focused': focused, 'is-minimized': minimized, 'is-maximized': maximized, 'is-dark-titlebar': darkTitlebar }"
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
        <button class="fwin-btn" title="Minimize" @mousedown.prevent @click="$emit('minimize')">
          <i class="bi bi-dash-lg"></i>
        </button>
        <button v-if="!mobile" class="fwin-btn" :title="maximized ? 'Restore' : 'Maximize'" @mousedown.prevent @click="$emit('toggle-maximize')">
          <i class="bi" :class="maximized ? 'bi-copy' : 'bi-square'"></i>
        </button>
        <button class="fwin-btn fwin-btn-close" title="Close" @mousedown.prevent @click="$emit('close')">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>

    <div class="fwin-body">
      <slot />
    </div>

    <template v-if="!mobile && !maximized">
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
}

.floating-window.is-maximized,
.floating-window.is-mobile {
  border-radius: 0;
}

.floating-window.is-dark-titlebar {
  border-color: #242424;
}

.floating-window.is-minimized {
  display: none;
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

.fwin-titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.6rem;
  background: #fff;
  flex-shrink: 0;
  user-select: none;
  cursor: move;
}

.floating-window.is-mobile .fwin-titlebar {
  cursor: default;
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
