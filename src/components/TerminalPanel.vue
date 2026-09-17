<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, computed, inject, nextTick, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Session } from 'xconn'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { floatingWindowToolbarKey } from '@/composables/floatingWindowToolbar'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import TabStrip from '@/components/TabStrip.vue'
import { openShell, type ShellHandle } from '@/services/shellStream'
import { isDataChannelClosedError, formatDesktopError } from '@/utils/desktopError'

const props = defineProps<{ realm: string; desktopName: string; embedded?: boolean; focused?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const sessionCacheStore = useSessionCacheStore()

// Absent when there's no FloatingWindow ancestor — the tab bar then renders
// inline instead of teleporting (see floatingWindowToolbar.ts).
const toolbarHostRef = inject(floatingWindowToolbarKey)
const toolbarTarget = computed(() => toolbarHostRef?.value ?? null)
const panelRef = ref<HTMLDivElement | null>(null)
const keybarRef = ref<HTMLDivElement | null>(null)

const enc = new TextEncoder()

interface TabState {
  id: number
  num: number
  label: string
  shellId: string
  term: Terminal | null
  fitAddon: FitAddon | null
  session: Session | null
  conn: ShellHandle | null
  closed: boolean
}

const tabs = shallowRef<TabState[]>([])
const activeTabId = ref(-1)
let nextTabId = 0
const termElMap = new Map<number, HTMLDivElement>()
const stripTabs = computed(() => tabs.value.map((t) => ({ id: t.id, label: t.label })))

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)

let keybarResizeObserver: ResizeObserver | null = null
let panelResizeObserver: ResizeObserver | null = null
let previousBodyOverflow = ''
let previousHtmlOverflow = ''
let previousBodyOverscrollBehavior = ''
let previousHtmlOverscrollBehavior = ''
let touchScrollLastY: number | null = null

const isMobile = computed(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0)
const ctrlActive = ref(false)
const panelViewportHeight = ref<number | null>(null)
const keybarHeight = ref(0)
const pressedKeys = ref<string[]>([])
const terminalInsetBottom = computed(() => (isMobile.value ? keybarHeight.value : 0))
const terminalPanelStyle = computed(() =>
  isMobile.value && panelViewportHeight.value !== null
    ? { height: `${panelViewportHeight.value}px` }
    : undefined,
)

function createTabState(): TabState {
  const used = new Set(tabs.value.map(t => t.num))
  let n = 1
  while (used.has(n)) n++
  return {
    id: nextTabId++,
    num: n,
    label: `Terminal ${n}`,
    shellId: '',
    term: null,
    fitAddon: null,
    session: null,
    conn: null,
    closed: false,
  }
}

function registerTermEl(id: number, el: unknown) {
  if (el instanceof HTMLDivElement) {
    termElMap.set(id, el)
  } else {
    termElMap.delete(id)
  }
}

function sendSize(tab: TabState) {
  if (!tab.term || !tab.conn) return
  tab.conn.resize(tab.term.cols, tab.term.rows)
}

function handleResizeTab(tab: TabState) {
  if (!tab.fitAddon) return
  tab.fitAddon.fit()
  sendSize(tab)
}

const handleResize = () => {
  const tab = activeTab.value
  if (tab) handleResizeTab(tab)
}

function handleTerminalInput(tab: TabState, data: string) {
  if (tab.closed || !tab.conn) return

  let input = data
  if (ctrlActive.value && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0) - 64
    input = code > 0 && code < 32 ? String.fromCharCode(code) : data
    ctrlActive.value = false
  }

  tab.conn.send(enc.encode(input))
}

function cleanupTab(tab: TabState) {
  if (tab.closed) return
  // Interrupt any foreground process (top, a stuck command, ...) so it exits
  // promptly on the pty hangup below, instead of leaving it running until
  // the process notices on its own.
  tab.conn?.send(enc.encode('\x03'))
  tab.closed = true
  tab.term?.dispose()
  tab.conn?.close()
  tab.conn = null
  tab.session = null
}

async function startShell(tab: TabState) {
  if (!tab.session || !tab.term) return

  try {
    const conn = await openShell(
      tab.session, props.realm, tab.term.cols, tab.term.rows,
      (bytes) => { if (!tab.closed) tab.term?.write(bytes) },
      () => { if (!tab.closed) closeTab(tab.id) },
    )
    if (tab.closed) { conn.close(); return }
    tab.conn = conn
    tab.shellId = conn.shellId
  } catch (err) {
    if (tab.closed) return
    if (isDataChannelClosedError(err)) sessionCacheStore.reportUnreachable(props.realm)
    tab.term.write(formatDesktopError(err, `Shell error: ${err}`))
  }
}

async function initTab(tab: TabState) {
  const el = termElMap.get(tab.id)
  if (!el) return

  tab.term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    convertEol: true,
    scrollback: 10000,
    fontSize: 14,
    theme: { background: '#1e1e1e' },
  })

  tab.fitAddon = new FitAddon()
  tab.term.loadAddon(tab.fitAddon)
  tab.term.open(el)
  tab.fitAddon.fit()
  tab.term.focus()

  try {
    tab.session = await sessionCacheStore.acquire(props.realm)
  } catch {
    tab.term.writeln('Connection failed.')
    return
  }

  if (!tab.session) {
    tab.term.writeln('Connection failed.')
    return
  }

  tab.term.onData((data) => handleTerminalInput(tab, data))
  tab.term.onTitleChange((title) => {
    if (tab.closed || !title) return
    tab.label = title
    tabs.value = [...tabs.value]
  })

  await startShell(tab)
}

async function addTab() {
  const tab = createTabState()
  tabs.value = [...tabs.value, tab]
  activeTabId.value = tab.id
  // initTab needs the new tab's .terminal-mount div (v-for'd below) to
  // already exist in the DOM before it can open the terminal into it.
  await nextTick()
  await initTab(tab)
}

async function switchTab(id: number) {
  if (activeTabId.value === id) {
    activeTab.value?.term?.focus()
    return
  }
  activeTabId.value = id
  await nextTick()
  const tab = tabs.value.find(t => t.id === id)
  if (tab) {
    tab.fitAddon?.fit()
    tab.term?.focus()
  }
}

function closeTab(id: number) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx === -1) return
  cleanupTab(tabs.value[idx]!)
  const remaining = tabs.value.filter(t => t.id !== id)
  tabs.value = remaining
  if (remaining.length === 0) {
    unlockPageScroll()
    emit('close')
    return
  }
  void switchTab(remaining[Math.min(idx, remaining.length - 1)]!.id)
}

// Mirrors GNOME Terminal: only warn when something other than the shell
// itself owns the pty's foreground (a running command, an ssh session, ...).
async function isTabBusy(tab: TabState): Promise<boolean> {
  if (!tab.session || !tab.shellId) return false
  try {
    const result = await tab.session.call('io.xconn.deskconn.deskconnd.shell.isbusy', [tab.shellId])
    return Boolean(result.args?.[0])
  } catch (err) {
    // Fails open (no warning) rather than blocking the close — but log it,
    // since a stale deskconnd without this RPC fails silently the same way.
    console.warn('shell.isbusy failed, assuming not busy:', err)
    return false
  }
}

// Two ways a busy tab can need confirming: closing that one tab (middle
// click / its own × button), or closing the whole window (FloatingWindow's
// titlebar × — DesktopSessionHost awaits requestClose() before unmounting
// this component, which is what would otherwise kill `top` with no warning).
type PendingClose =
  | { kind: 'tab'; tab: TabState }
  | { kind: 'window'; resolve: (ok: boolean) => void }

const pendingClose = ref<PendingClose | null>(null)
const closeConfirmTitle = computed(() => {
  const p = pendingClose.value
  if (!p) return ''
  return p.kind === 'tab' ? `Close "${p.tab.label}"?` : 'Close this terminal window?'
})

async function requestCloseTab(id: number) {
  const tab = tabs.value.find(t => t.id === id)
  if (!tab) return
  if (await isTabBusy(tab)) {
    pendingClose.value = { kind: 'tab', tab }
    return
  }
  closeTab(id)
}

// Called by DesktopSessionHost before it unmounts this window.
async function requestClose(): Promise<boolean> {
  const busy = await Promise.all(tabs.value.map((t) => isTabBusy(t)))
  if (!busy.some(Boolean)) return true
  return new Promise<boolean>((resolve) => {
    pendingClose.value = { kind: 'window', resolve }
  })
}

defineExpose({ requestClose })

function confirmPendingClose() {
  const p = pendingClose.value
  pendingClose.value = null
  if (!p) return
  if (p.kind === 'tab') closeTab(p.tab.id)
  else p.resolve(true)
}

function cancelPendingClose() {
  const p = pendingClose.value
  pendingClose.value = null
  if (p?.kind === 'window') p.resolve(false)
}

const updateKeybarPosition = () => {
  requestAnimationFrame(() => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const panelTop = panelRef.value?.getBoundingClientRect().top ?? 0
    panelViewportHeight.value = Math.max(0, viewportHeight - Math.max(panelTop, 0))
    keybarHeight.value = keybarRef.value?.offsetHeight ?? keybarHeight.value
  })
}

const observePanelSize = () => {
  if (!panelRef.value || typeof ResizeObserver === 'undefined') return

  panelResizeObserver?.disconnect()
  panelResizeObserver = new ResizeObserver(() => {
    if (activeTab.value) handleResizeTab(activeTab.value)
  })
  panelResizeObserver.observe(panelRef.value)
}

const observeKeybarHeight = () => {
  keybarHeight.value = keybarRef.value?.offsetHeight ?? 0

  if (!keybarRef.value || typeof ResizeObserver === 'undefined') return

  keybarResizeObserver?.disconnect()
  keybarResizeObserver = new ResizeObserver(() => {
    keybarHeight.value = keybarRef.value?.offsetHeight ?? 0
  })
  keybarResizeObserver.observe(keybarRef.value)
}

const arrowKeys = {
  up: '\x1b[A',
  left: '\x1b[D',
  down: '\x1b[B',
  right: '\x1b[C',
}

const triggerHapticFeedback = () => {
  navigator.vibrate?.(12)
}

const setKeyPressed = (label: string, pressed: boolean) => {
  const next = new Set(pressedKeys.value)
  if (pressed) {
    next.add(label)
  } else {
    next.delete(label)
  }
  pressedKeys.value = [...next]
}

const isKeyPressed = (label: string) => pressedKeys.value.includes(label)

const lockPageScroll = () => {
  previousBodyOverflow = document.body.style.overflow
  previousHtmlOverflow = document.documentElement.style.overflow
  previousBodyOverscrollBehavior = document.body.style.overscrollBehavior
  previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior

  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overscrollBehavior = 'none'
  document.documentElement.style.overscrollBehavior = 'none'
}

const unlockPageScroll = () => {
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousHtmlOverflow
  document.body.style.overscrollBehavior = previousBodyOverscrollBehavior
  document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior
}

const clearTerminalTouchScroll = () => {
  touchScrollLastY = null
}

const handleTerminalTouchStart = (event: TouchEvent) => {
  if (!isMobile.value || event.touches.length !== 1) return
  const touch = event.touches.item(0)
  if (!touch) return
  touchScrollLastY = touch.clientY
}

const handleTerminalTouchMove = (event: TouchEvent) => {
  if (!isMobile.value || event.touches.length !== 1 || touchScrollLastY === null) return

  const touch = event.touches.item(0)
  if (!touch) return

  const nextY = touch.clientY
  const deltaY = nextY - touchScrollLastY
  if (Math.abs(deltaY) < 4) return

  event.preventDefault()
  activeTab.value?.term?.scrollLines(Math.round(-deltaY / 16))
  touchScrollLastY = nextY
}

const pressMobileKey = (seq: string, label: string) => {
  setKeyPressed(label, true)
  triggerHapticFeedback()
  if (label === 'CTRL') {
    ctrlActive.value = !ctrlActive.value
    return
  }
  const tab = activeTab.value
  if (tab) handleTerminalInput(tab, seq)
  tab?.term?.focus()
}

const releaseMobileKey = (label: string) => {
  setKeyPressed(label, false)
}

function handleTabShortcut(e: KeyboardEvent) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return
  const n = parseInt(e.key, 10)
  if (n >= 1 && n <= 9) {
    const tab = tabs.value[n - 1]
    if (tab) {
      e.preventDefault()
      e.stopPropagation()
      void switchTab(tab.id)
    }
  }
}

onMounted(async () => {
  if (isMobile.value) {
    lockPageScroll()
  }

  window.addEventListener('keydown', handleTabShortcut, true)
  window.addEventListener('resize', handleResize)
  window.visualViewport?.addEventListener('resize', updateKeybarPosition)
  window.visualViewport?.addEventListener('scroll', updateKeybarPosition)
  await nextTick()
  observeKeybarHeight()
  observePanelSize()
  updateKeybarPosition()

  await addTab()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleTabShortcut, true)
  window.removeEventListener('resize', handleResize)
  window.visualViewport?.removeEventListener('resize', updateKeybarPosition)
  window.visualViewport?.removeEventListener('scroll', updateKeybarPosition)
  keybarResizeObserver?.disconnect()
  keybarResizeObserver = null
  panelResizeObserver?.disconnect()
  panelResizeObserver = null
  clearTerminalTouchScroll()
  unlockPageScroll()
  for (const tab of tabs.value) cleanupTab(tab)
})

watch([terminalInsetBottom, panelViewportHeight], () => {
  requestAnimationFrame(() => {
    handleResize()
  })
})

// Window focus doesn't move DOM focus, so refocus xterm ourselves.
watch(() => props.focused, (focused) => {
  if (focused) activeTab.value?.term?.focus()
}, { flush: 'post' })
</script>

<template>
  <div ref="panelRef" class="terminal-panel" :style="terminalPanelStyle">
    <Teleport :to="toolbarTarget ?? 'body'" :disabled="!toolbarTarget">
      <TabStrip
        class="tab-bar-bleed"
        :tabs="stripTabs"
        :active-id="activeTabId"
        new-tab-title="New terminal"
        @switch="switchTab"
        @close="requestCloseTab"
        @add="addTab"
      />
    </Teleport>

    <div
      v-for="tab in tabs"
      :key="tab.id"
      v-show="tab.id === activeTabId"
      class="terminal-body"
      @touchstart="handleTerminalTouchStart"
      @touchmove="handleTerminalTouchMove"
      @touchend="clearTerminalTouchScroll"
      @touchcancel="clearTerminalTouchScroll"
    >
      <div :ref="(el) => registerTermEl(tab.id, el)" class="terminal-mount"></div>
    </div>

    <div
      v-if="isMobile"
      class="terminal-keybar-spacer"
      :style="{ height: terminalInsetBottom + 'px' }"
      aria-hidden="true"
    ></div>
    <div ref="keybarRef" v-if="isMobile" class="mobile-keybar">
      <div class="keybar-grid">
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('ESC') }"
          @pointerdown.prevent="pressMobileKey('\x1b', 'ESC')"
          @pointerup.prevent="releaseMobileKey('ESC')"
          @pointercancel="releaseMobileKey('ESC')"
          @pointerleave="releaseMobileKey('ESC')"
        >ESC</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('TAB') }"
          @pointerdown.prevent="pressMobileKey('\t', 'TAB')"
          @pointerup.prevent="releaseMobileKey('TAB')"
          @pointercancel="releaseMobileKey('TAB')"
          @pointerleave="releaseMobileKey('TAB')"
        >TAB</button>
        <button
          class="mobile-key"
          :class="{ 'ctrl-active': ctrlActive, 'is-pressed': isKeyPressed('CTRL') }"
          @pointerdown.prevent="pressMobileKey('', 'CTRL')"
          @pointerup.prevent="releaseMobileKey('CTRL')"
          @pointercancel="releaseMobileKey('CTRL')"
          @pointerleave="releaseMobileKey('CTRL')"
        >CTRL</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('-') }"
          @pointerdown.prevent="pressMobileKey('-', '-')"
          @pointerup.prevent="releaseMobileKey('-')"
          @pointercancel="releaseMobileKey('-')"
          @pointerleave="releaseMobileKey('-')"
        >-</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('↑') }"
          @pointerdown.prevent="pressMobileKey(arrowKeys.up, '↑')"
          @pointerup.prevent="releaseMobileKey('↑')"
          @pointercancel="releaseMobileKey('↑')"
          @pointerleave="releaseMobileKey('↑')"
        >↑</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('DEL') }"
          @pointerdown.prevent="pressMobileKey('\x1b[3~', 'DEL')"
          @pointerup.prevent="releaseMobileKey('DEL')"
          @pointercancel="releaseMobileKey('DEL')"
          @pointerleave="releaseMobileKey('DEL')"
        >DEL</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('HOME') }"
          @pointerdown.prevent="pressMobileKey('\x1b[H', 'HOME')"
          @pointerup.prevent="releaseMobileKey('HOME')"
          @pointercancel="releaseMobileKey('HOME')"
          @pointerleave="releaseMobileKey('HOME')"
        >HOME</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('END') }"
          @pointerdown.prevent="pressMobileKey('\x1b[F', 'END')"
          @pointerup.prevent="releaseMobileKey('END')"
          @pointercancel="releaseMobileKey('END')"
          @pointerleave="releaseMobileKey('END')"
        >END</button>

        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('^C') }"
          @pointerdown.prevent="pressMobileKey('\x03', '^C')"
          @pointerup.prevent="releaseMobileKey('^C')"
          @pointercancel="releaseMobileKey('^C')"
          @pointerleave="releaseMobileKey('^C')"
        >^C</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('^D') }"
          @pointerdown.prevent="pressMobileKey('\x04', '^D')"
          @pointerup.prevent="releaseMobileKey('^D')"
          @pointercancel="releaseMobileKey('^D')"
          @pointerleave="releaseMobileKey('^D')"
        >^D</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('/') }"
          @pointerdown.prevent="pressMobileKey('/', '/')"
          @pointerup.prevent="releaseMobileKey('/')"
          @pointercancel="releaseMobileKey('/')"
          @pointerleave="releaseMobileKey('/')"
        >/</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('←') }"
          @pointerdown.prevent="pressMobileKey(arrowKeys.left, '←')"
          @pointerup.prevent="releaseMobileKey('←')"
          @pointercancel="releaseMobileKey('←')"
          @pointerleave="releaseMobileKey('←')"
        >←</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('↓') }"
          @pointerdown.prevent="pressMobileKey(arrowKeys.down, '↓')"
          @pointerup.prevent="releaseMobileKey('↓')"
          @pointercancel="releaseMobileKey('↓')"
          @pointerleave="releaseMobileKey('↓')"
        >↓</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('→') }"
          @pointerdown.prevent="pressMobileKey(arrowKeys.right, '→')"
          @pointerup.prevent="releaseMobileKey('→')"
          @pointercancel="releaseMobileKey('→')"
          @pointerleave="releaseMobileKey('→')"
        >→</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('PgUp') }"
          @pointerdown.prevent="pressMobileKey('\x1b[5~', 'PgUp')"
          @pointerup.prevent="releaseMobileKey('PgUp')"
          @pointercancel="releaseMobileKey('PgUp')"
          @pointerleave="releaseMobileKey('PgUp')"
        >PgUp</button>
        <button
          class="mobile-key"
          :class="{ 'is-pressed': isKeyPressed('PgDn') }"
          @pointerdown.prevent="pressMobileKey('\x1b[6~', 'PgDn')"
          @pointerup.prevent="releaseMobileKey('PgDn')"
          @pointercancel="releaseMobileKey('PgDn')"
          @pointerleave="releaseMobileKey('PgDn')"
        >PgDn</button>
      </div>
    </div>

    <ConfirmDialog
      :open="!!pendingClose"
      :title="closeConfirmTitle"
      message="It has a running process. Closing it may end that process."
      confirm-label="Close"
      @confirm="confirmPendingClose"
      @cancel="cancelPendingClose"
    />
  </div>
</template>

<style scoped>
.terminal-panel {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-height: 0;
  overscroll-behavior: contain;
}

/* Terminal only ever renders inside a FloatingWindow, and TabStrip is the
   sole content teleported into its titlebar — bleeds into the titlebar's
   own 0.25rem/0.6rem padding so the 32px-tall tab strip fills it
   edge-to-edge instead of sitting inside it (see TabStrip.vue for why this
   isn't baked into the component itself: TextEditor nests it next to a
   "Files" button and bleeds its own wrapper instead). */
.tab-bar-bleed {
  margin: -0.25rem 0 -0.25rem -0.6rem;
}

.terminal-body {
  flex: 1;
  min-height: 0;
  padding: 4px;
  overflow: hidden;
  background: #1e1e1e;
  overscroll-behavior: contain;
  touch-action: none;
}

.terminal-keybar-spacer {
  flex-shrink: 0;
}

.mobile-keybar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: #252525;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 100;
}

.keybar-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 3px;
  padding: 4px 4px 6px;
}

.mobile-key {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  background: #3a3a3a;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: 2px solid rgba(0, 0, 0, 0.4);
  color: #cbd5e1;
  font-size: 0.65rem;
  font-family: monospace;
  padding: 8px 4px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  text-overflow: ellipsis;
  touch-action: manipulation;
  transition:
    background 0.1s,
    border-color 0.1s,
    border-bottom-color 0.1s,
    box-shadow 0.1s,
    transform 0.1s;
}

.mobile-key.is-pressed,
.mobile-key:active {
  background: #565656;
  border-bottom-color: rgba(0, 0, 0, 0.18);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
  transform: translateY(1px);
}

.mobile-key.ctrl-active {
  background: #1d4ed8;
  border-color: #3b82f6;
  color: #fff;
}

.mobile-key.ctrl-active.is-pressed,
.mobile-key.ctrl-active:active {
  background: #1e40af;
}

.terminal-mount {
  width: 100%;
  height: 100%;
}

.terminal-body :deep(.xterm) {
  height: 100%;
}

.terminal-body :deep(.xterm-viewport) {
  background: #1e1e1e !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
