<script setup lang="ts">
import { ref } from 'vue'

const rootEl = ref<HTMLElement | null>(null)

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
  if (props.mobile || props.maximized) return
  const target = e.target as HTMLElement
  if (target.closest('.fwin-controls')) return

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
      const maxX = Math.max(0, container.clientWidth - props.width)
      const maxY = Math.max(0, container.clientHeight - props.height)
      x = Math.min(Math.max(x, 0), maxX)
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
      if (container) width = Math.min(width, container.clientWidth - originX)
      bounds.width = width
    }
    if (dir.includes('s')) {
      let height = Math.max(MIN_HEIGHT, originH + dy)
      if (container) height = Math.min(height, container.clientHeight - originY)
      bounds.height = height
    }
    if (dir.includes('w')) {
      let width = Math.max(MIN_WIDTH, originW - dx)
      let x = originX + (originW - width)
      if (x < 0) {
        x = 0
        width = originX + originW
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
    :class="{ 'is-mobile': mobile, 'is-focused': focused, 'is-minimized': minimized }"
    :style="mobile ? { zIndex } : {
      left: x + 'px',
      top: y + 'px',
      width: width + 'px',
      height: height + 'px',
      zIndex,
    }"
    @pointerdown="$emit('focus')"
  >
    <div class="fwin-titlebar" @pointerdown="startDrag">
      <span class="fwin-icon" :style="{ color: iconColor, background: iconBg }">
        <i class="bi" :class="icon"></i>
      </span>
      <span class="fwin-title">{{ title }}</span>
      <div class="fwin-controls">
        <button class="fwin-btn" title="Minimize" @click="$emit('minimize')">
          <i class="bi bi-dash-lg"></i>
        </button>
        <button v-if="!mobile" class="fwin-btn" :title="maximized ? 'Restore' : 'Maximize'" @click="$emit('toggle-maximize')">
          <i class="bi" :class="maximized ? 'bi-copy' : 'bi-square'"></i>
        </button>
        <button class="fwin-btn fwin-btn-close" title="Close" @click="$emit('close')">
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
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  overflow: hidden;
  min-width: 280px;
  min-height: 200px;
}

.floating-window.is-minimized {
  display: none;
}

.floating-window.is-focused {
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
  border-color: #cbd5e1;
}

.floating-window.is-mobile {
  position: fixed;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  border-radius: 0;
  border: none;
}

.fwin-titlebar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid #e8ecf0;
  background: #f8fafc;
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
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 0.72rem;
  cursor: pointer;
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
