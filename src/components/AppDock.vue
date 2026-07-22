<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { AppWindow } from '@/composables/useWindowManager'
import { useMachinesOverviewStore } from '@/stores/machinesOverview'

export interface DockAppDef {
  id: string
  label: string
  icon: string
  iconColor: string
  iconBg: string
  /** False for apps that only ever appear because a window is already open (e.g.
   * Image Viewer/Video Player) — they can't be launched blank, so no "New window". */
  launchable?: boolean
}

const props = defineProps<{
  realm: string
  apps: DockAppDef[]
  windows: AppWindow[]
  focusedId: string | null
  position: 'bottom' | 'left' | 'right'
  offline?: boolean
}>()

const emit = defineEmits<{
  launch: [appId: string]
  activate: [windowId: string]
  close: [windowId: string]
  exit: []
}>()

const machinesOverviewStore = useMachinesOverviewStore()

const dockRootRef = ref<HTMLElement | null>(null)
const iconEls = new Map<string, HTMLElement>()
function setIconRef(id: string, el: Element | null) {
  if (el) iconEls.set(id, el as HTMLElement)
  else iconEls.delete(id)
}

// Pinned order is per-machine, not shared across every dock — otherwise
// reordering icons on one machine "duplicates" onto every other machine.
const storageKey = `dock_pinned_order_${props.realm}`

function loadPinnedOrder(): string[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore malformed storage
  }
  return []
}

const pinnedOrder = ref<string[]>(loadPinnedOrder())

// Reconcile stored order against the current app list: keep known ids in their
// stored order, append any new ones, drop ids that no longer exist.
watch(
  () => props.apps.map((a) => a.id),
  (ids) => {
    const idSet = new Set(ids)
    const kept = pinnedOrder.value.filter((id) => idSet.has(id))
    const missing = ids.filter((id) => !kept.includes(id))
    pinnedOrder.value = [...kept, ...missing]
  },
  { immediate: true },
)

function persistPinnedOrder() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pinnedOrder.value))
  } catch {
    // storage failure is non-fatal
  }
}

const orderedApps = computed(() =>
  pinnedOrder.value
    .map((id) => props.apps.find((a) => a.id === id))
    .filter((a): a is DockAppDef => !!a),
)

const instancesByApp = computed(() => {
  const map = new Map<string, AppWindow[]>()
  for (const win of props.windows) {
    const arr = map.get(win.appId) ?? []
    arr.push(win)
    map.set(win.appId, arr)
  }
  return map
})

function dotCount(appId: string): number {
  return Math.min(instancesByApp.value.get(appId)?.length ?? 0, 4)
}

function isAppFocused(appId: string): boolean {
  if (!props.focusedId) return false
  return (instancesByApp.value.get(appId) ?? []).some((w) => w.id === props.focusedId)
}

const openPopoverAppId = ref<string | null>(null)
const popoverRef = ref<HTMLElement | null>(null)

// Fixed pixel coordinates, computed from the icon's rect at open-time. The
// popover (and tooltip, below) are teleported to <body> and positioned this
// way (rather than nested + position:absolute inside the dock) because the
// dock's icon strip scrolls (overflow-x/y: auto) when there are many pinned
// icons — a popover positioned relative to a scrollable ancestor gets
// clipped by it.
const popoverStyle = ref<Record<string, string>>({})
const POPOVER_GAP = 10

// Anchors a flyout (popover or tooltip) to the icon's edge that faces away
// from the dock, offset by `gap`.
function anchoredStyleFor(appId: string, gap: number): Record<string, string> | null {
  const iconEl = iconEls.get(appId)
  if (!iconEl) return null
  const rect = iconEl.getBoundingClientRect()

  switch (props.position) {
    case 'left':
      return {
        left: `${rect.right + gap}px`,
        top: `${rect.top + rect.height / 2}px`,
        transform: 'translateY(-50%)',
      }
    case 'right':
      return {
        left: `${rect.left - gap}px`,
        top: `${rect.top + rect.height / 2}px`,
        transform: 'translate(-100%, -50%)',
      }
    default:
      return {
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.top - gap}px`,
        transform: 'translate(-50%, -100%)',
      }
  }
}

function computePopoverStyle(appId: string) {
  const style = anchoredStyleFor(appId, POPOVER_GAP)
  if (style) popoverStyle.value = style
}

const hoveredAppId = ref<string | null>(null)
const tooltipStyle = ref<Record<string, string>>({})
const TOOLTIP_GAP = 8

function showTooltip(appId: string) {
  if (dragState || openPopoverAppId.value) return
  const style = anchoredStyleFor(appId, TOOLTIP_GAP)
  if (!style) return
  tooltipStyle.value = style
  hoveredAppId.value = appId
}

function hideTooltip() {
  hoveredAppId.value = null
}

function togglePopover(appId: string) {
  hideTooltip()
  if (openPopoverAppId.value === appId) {
    openPopoverAppId.value = null
    return
  }
  computePopoverStyle(appId)
  openPopoverAppId.value = appId
}

function activateInstance(id: string) {
  emit('activate', id)
  openPopoverAppId.value = null
}

function launchNew(appId: string) {
  emit('launch', appId)
  openPopoverAppId.value = null
}

function closeInstance(id: string, e: Event) {
  e.stopPropagation()
  emit('close', id)
}

function quitAll(appId: string) {
  const instances = instancesByApp.value.get(appId) ?? []
  for (const win of instances) emit('close', win.id)
  openPopoverAppId.value = null
}

function handleIconClick(appId: string) {
  const instances = instancesByApp.value.get(appId) ?? []
  if (instances.length === 0) {
    const app = props.apps.find((a) => a.id === appId)
    if (!props.offline && app?.launchable !== false) emit('launch', appId)
  } else if (instances.length === 1) {
    activateInstance(instances[0]!.id)
  } else {
    togglePopover(appId)
  }
}

// Right-click always opens the instance/"New window" menu, even with 0 or 1
// running instances — otherwise there'd be no way to open a 2nd instance of
// an app once one is already running (a plain click just focuses it).
function handleIconContextMenu(appId: string) {
  togglePopover(appId)
}

interface DragState {
  appId: string
  startX: number
  startY: number
  moved: boolean
}

let dragState: DragState | null = null

function onIconPointerDown(appId: string, e: PointerEvent) {
  if (e.button !== 0) return
  hideTooltip()
  dragState = { appId, startX: e.clientX, startY: e.clientY, moved: false }
  window.addEventListener('pointermove', onIconPointerMove)
  window.addEventListener('pointerup', onIconPointerUp)
}

const DRAG_THRESHOLD = 6

function onIconPointerMove(e: PointerEvent) {
  if (!dragState) return
  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY

  if (!dragState.moved) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    dragState.moved = true
  }

  const axisPos = props.position === 'bottom' ? e.clientX : e.clientY
  const order = pinnedOrder.value
  const fromIdx = order.indexOf(dragState.appId)
  if (fromIdx === -1) return

  for (const [id, el] of iconEls) {
    if (id === dragState.appId) continue
    const rect = el.getBoundingClientRect()
    const mid = props.position === 'bottom' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    const otherIdx = order.indexOf(id)
    if (otherIdx === -1) continue

    if (fromIdx < otherIdx && axisPos > mid) {
      moveDraggedTo(otherIdx)
      break
    } else if (fromIdx > otherIdx && axisPos < mid) {
      moveDraggedTo(otherIdx)
      break
    }
  }
}

function moveDraggedTo(targetIdx: number) {
  if (!dragState) return
  const order = [...pinnedOrder.value]
  const from = order.indexOf(dragState.appId)
  if (from === -1) return
  order.splice(from, 1)
  order.splice(targetIdx, 0, dragState.appId)
  pinnedOrder.value = order
}

function onIconPointerUp() {
  window.removeEventListener('pointermove', onIconPointerMove)
  window.removeEventListener('pointerup', onIconPointerUp)
  if (!dragState) return

  const { appId, moved } = dragState
  dragState = null

  if (moved) {
    persistPinnedOrder()
  } else {
    handleIconClick(appId)
  }
}

function onWindowClick(e: MouseEvent) {
  if (!openPopoverAppId.value) return
  const target = e.target as Node
  // The popover is teleported to <body>, so it's no longer a DOM descendant
  // of dockRootRef — check both.
  if (dockRootRef.value?.contains(target)) return
  if (popoverRef.value?.contains(target)) return
  openPopoverAppId.value = null
}

onMounted(() => window.addEventListener('click', onWindowClick, true))
onUnmounted(() => window.removeEventListener('click', onWindowClick, true))
</script>

<template>
  <div ref="dockRootRef" class="dock" :class="`dock-${position}`">
    <div class="dock-inner">
      <button
        class="dock-icon dock-icon-machines"
        title="Machines"
        @click="machinesOverviewStore.toggle()"
      >
        <i class="bi bi-grid-3x3-gap-fill"></i>
      </button>

      <div class="dock-divider"></div>

      <div
        v-for="app in orderedApps"
        :key="app.id"
        class="dock-icon-wrapper"
        :ref="(el) => setIconRef(app.id, el as Element | null)"
      >
        <button
          class="dock-icon"
          :class="{ 'dock-icon-focused': isAppFocused(app.id), 'dock-icon-disabled': offline }"
          :style="{ color: app.iconColor, background: app.iconBg }"
          :aria-label="offline ? `${app.label} (offline)` : app.label"
          @pointerdown="onIconPointerDown(app.id, $event)"
          @contextmenu.prevent="handleIconContextMenu(app.id)"
          @mouseenter="showTooltip(app.id)"
          @mouseleave="hideTooltip"
        >
          <i class="bi" :class="app.icon"></i>
        </button>
        <span v-if="dotCount(app.id) > 0" class="dock-dots">
          <span v-for="n in dotCount(app.id)" :key="n" class="dock-dot"></span>
        </span>

        <Teleport to="body">
        <div
          v-if="hoveredAppId === app.id"
          class="dock-tooltip"
          :style="tooltipStyle"
        >{{ offline ? `${app.label} (offline)` : app.label }}</div>
        </Teleport>

        <Teleport to="body">
        <div
          v-if="openPopoverAppId === app.id"
          :ref="(el) => (popoverRef = el as HTMLElement | null)"
          class="dock-popover"
          :style="popoverStyle"
          @click.stop
        >
          <div class="dock-popover-title">{{ app.label }}</div>
          <button
            v-for="win in instancesByApp.get(app.id)"
            :key="win.id"
            class="dock-popover-row"
            :class="{ 'dock-popover-row-active': focusedId === win.id }"
            @click="activateInstance(win.id)"
          >
            <span class="dock-popover-icon" :style="{ color: win.iconColor, background: win.iconBg }">
              <i class="bi" :class="win.icon"></i>
            </span>
            <span class="dock-popover-label">{{ win.title }}</span>
            <span v-if="win.minimized" class="dock-popover-minimized">minimized</span>
            <span class="dock-popover-close" title="Close" @click="closeInstance(win.id, $event)">
              <i class="bi bi-x"></i>
            </span>
          </button>
          <button v-if="app.launchable !== false" class="dock-popover-row dock-popover-new" @click="launchNew(app.id)">
            <span class="dock-popover-icon dock-popover-icon-new">
              <i class="bi bi-plus-lg"></i>
            </span>
            <span class="dock-popover-label">New Window</span>
          </button>
          <button
            v-if="(instancesByApp.get(app.id)?.length ?? 0) > 0"
            class="dock-popover-row dock-popover-quit"
            @click="quitAll(app.id)"
          >
            <span class="dock-popover-icon dock-popover-icon-quit">
              <i class="bi bi-power"></i>
            </span>
            <span class="dock-popover-label">
              {{ instancesByApp.get(app.id)!.length === 1 ? 'Quit' : `Quit ${instancesByApp.get(app.id)!.length} Windows` }}
            </span>
          </button>
        </div>
        </Teleport>
      </div>

      <div class="dock-divider"></div>

      <button class="dock-icon dock-icon-exit" title="Exit to Dashboard" @click="emit('exit')">
        <i class="bi bi-house-door-fill"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dock {
  position: absolute;
  display: flex;
  z-index: 10;
  pointer-events: auto;
  background: rgba(20, 20, 22, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.dock-inner {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem;
}

/* Bottom (default): horizontal bar along the bottom edge */
.dock-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.25);
  min-height: 4.5rem;
  overflow-x: auto;
}

.dock-bottom .dock-inner {
  flex-direction: row;
}

.dock-bottom .dock-divider {
  width: 1px;
  align-self: stretch;
  margin: 0.25rem 0.15rem;
}

/* Left / right: vertical bar along the side edge */
.dock-left,
.dock-right {
  top: 0;
  bottom: 0;
  flex-direction: column;
  min-width: 4.5rem;
  overflow-y: auto;
}

.dock-left {
  left: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25);
}

.dock-right {
  right: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.25);
}

.dock-left .dock-inner,
.dock-right .dock-inner {
  flex-direction: column;
}

.dock-left .dock-divider,
.dock-right .dock-divider {
  height: 1px;
  align-self: stretch;
  margin: 0.15rem 0.25rem;
}

.dock-divider {
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.dock-icon-wrapper {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

.dock-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border: none;
  border-radius: 10px;
  background: #eef2f6;
  color: #475569;
  font-size: 2rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.13s ease, transform 0.1s ease;
}

.dock-icon:hover {
  transform: translateY(-2px);
}

.dock-left .dock-icon:hover,
.dock-right .dock-icon:hover {
  transform: translateX(2px);
}

.dock-icon-machines {
  color: rgba(255, 255, 255, 0.85);
  background: transparent;
}

.dock-icon-focused {
  outline: 2px solid rgba(59, 130, 246, 0.45);
  outline-offset: -2px;
}

.dock-icon-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dock-icon-disabled:hover {
  transform: none;
}

.dock-dots {
  position: absolute;
  display: flex;
  gap: 3px;
  pointer-events: none;
}

/* Indicator sits just outside the icon square, on the edge that touches the
   screen border — not on top of the glyph, which fills the square. */
.dock-bottom .dock-dots {
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: row;
}

.dock-left .dock-dots {
  left: -5px;
  top: 50%;
  transform: translateY(-50%);
  flex-direction: column;
}

.dock-right .dock-dots {
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  flex-direction: column;
}

.dock-dot {
  width: 6.5px;
  height: 6.5px;
  border-radius: 50%;
  background: #f97316;
}

/* App-name tooltip — same teleport-and-anchor approach as .dock-popover below. */
.dock-tooltip {
  position: fixed;
  padding: 0.3rem 0.6rem;
  background: rgba(20, 20, 22, 0.92);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  z-index: 2100;
}

/* Instance switcher popover — teleported to <body> and positioned via an
   inline style computed from the icon's rect (see computePopoverStyle),
   since it needs to escape the dock's scrollable icon strip. */
.dock-popover {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 200px;
  max-width: 260px;
  padding: 0.4rem;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  z-index: 2100;
}

.dock-popover-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  padding: 0.25rem 0.5rem;
}

.dock-popover-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 7px;
  padding: 0.4rem 0.5rem;
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  text-align: left;
}

.dock-popover-row:hover {
  background: #eef2f6;
}

.dock-popover-row-active {
  background: #dbeafe;
}

.dock-popover-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  flex-shrink: 0;
}

.dock-popover-icon-new {
  background: #eef2f6;
  color: #475569;
}

.dock-popover-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dock-popover-minimized {
  font-size: 0.65rem;
  color: #94a3b8;
  flex-shrink: 0;
}

.dock-popover-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #94a3b8;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: background 0.13s ease, color 0.13s ease;
}

.dock-popover-close:hover {
  background: #fee2e2;
  color: #dc2626;
}

.dock-popover-new {
  border-top: 1px solid #f1f5f9;
  margin-top: 0.15rem;
  padding-top: 0.5rem;
  color: #475569;
}

.dock-popover-quit {
  color: #dc2626;
}

.dock-popover-quit:hover {
  background: #fee2e2;
}

.dock-popover-icon-quit {
  background: #fee2e2;
  color: #dc2626;
}

.dock-icon-exit {
  color: rgba(255, 255, 255, 0.85);
  background: transparent;
}
</style>
