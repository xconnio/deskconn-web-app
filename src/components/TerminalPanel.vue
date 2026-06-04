<script setup lang="ts">
import { ref, shallowRef, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import WindowTitleBar from '@/components/WindowTitleBar.vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ApplicationError, Progress, Result, Session } from 'xconn'
import { useSessionCacheStore } from '@/stores/sessionCache'
import {
  createX25519KeyPair,
  deriveSessionKeys,
  encryptPayload,
  decryptPayload,
} from '@/utils/encryption'

const props = defineProps<{ realm: string; desktopName: string }>()
const emit = defineEmits<{ close: [] }>()

const sessionCacheStore = useSessionCacheStore()
const panelRef = ref<HTMLDivElement | null>(null)
const keybarRef = ref<HTMLDivElement | null>(null)

const enc = new TextEncoder()
const dec = new TextDecoder()

class ProgressChannel {
  private queue: Progress[] = []
  private waiting: ((p: Progress) => void) | null = null

  push(p: Progress) {
    if (this.waiting) {
      this.waiting(p)
      this.waiting = null
    } else {
      this.queue.push(p)
    }
  }

  async next(): Promise<Progress> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => { this.waiting = resolve })
  }
}

interface TabState {
  id: number
  num: number
  label: string
  shellId: string
  term: Terminal | null
  fitAddon: FitAddon | null
  session: Session | null
  channel: ProgressChannel | null
  closed: boolean
  encKeys: { encryptKey: Uint8Array; decryptKey: Uint8Array } | null
  encryptionMode: 'pending' | 'enabled' | 'disabled'
  clientPrivateKey: Uint8Array | null
  clientPublicKey: Uint8Array | null
  pendingInputs: Uint8Array[]
  isFirstSizeSent: boolean
}

const tabs = shallowRef<TabState[]>([])
const activeTabId = ref(-1)
let nextTabId = 0
const termElMap = new Map<number, HTMLDivElement>()

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)

let keybarResizeObserver: ResizeObserver | null = null
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
    channel: null,
    closed: false,
    encKeys: null,
    encryptionMode: 'pending',
    clientPrivateKey: null,
    clientPublicKey: null,
    pendingInputs: [],
    isFirstSizeSent: false,
  }
}

function registerTermEl(id: number, el: unknown) {
  if (el instanceof HTMLDivElement) {
    termElMap.set(id, el)
  } else {
    termElMap.delete(id)
  }
}

function pushEncrypted(tab: TabState, bytes: Uint8Array) {
  if (!tab.channel) return
  const encrypted = tab.encKeys ? encryptPayload(bytes, tab.encKeys.encryptKey) : bytes
  // Non-first shells must prefix every frame with "<shellId>:" so the server can route it.
  let payload: Uint8Array
  if (tab.shellId) {
    const prefix = enc.encode(tab.shellId + ':')
    payload = new Uint8Array(prefix.length + encrypted.length)
    payload.set(prefix)
    payload.set(encrypted, prefix.length)
  } else {
    payload = encrypted
  }
  tab.channel.push(new Progress([payload], {}, { progress: true }))
}

function sendSize(tab: TabState) {
  if (!tab.term || !tab.channel) return
  const { cols, rows } = tab.term
  const sizeStr = `SIZE:${cols}:${rows}`

  if (!tab.isFirstSizeSent) {
    tab.isFirstSizeSent = true
    const sizeBytes = enc.encode(sizeStr)
    const keyMarker = enc.encode(':KEY:')
    const first = new Uint8Array(sizeBytes.length + keyMarker.length + tab.clientPublicKey!.length)
    first.set(sizeBytes, 0)
    first.set(keyMarker, sizeBytes.length)
    first.set(tab.clientPublicKey!, sizeBytes.length + keyMarker.length)
    tab.channel.push(new Progress([first], {}, { progress: true }))
    return
  }

  if (tab.encryptionMode === 'enabled') {
    pushEncrypted(tab, enc.encode(sizeStr))
  } else if (tab.encryptionMode === 'disabled') {
    tab.channel.push(new Progress([sizeStr], {}, { progress: true }))
  }
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
  if (tab.closed || !tab.channel) return

  let input = data
  if (ctrlActive.value && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0) - 64
    input = code > 0 && code < 32 ? String.fromCharCode(code) : data
    ctrlActive.value = false
  }

  const bytes = enc.encode(input)
  if (tab.encryptionMode === 'pending') {
    tab.pendingInputs.push(bytes)
    return
  }
  if (tab.encryptionMode === 'enabled') {
    pushEncrypted(tab, bytes)
  } else {
    tab.channel.push(new Progress([input], {}, { progress: true }))
  }
}

function flushPendingInputs(tab: TabState) {
  for (const bytes of tab.pendingInputs) {
    if (tab.encryptionMode === 'enabled') {
      pushEncrypted(tab, bytes)
    } else {
      tab.channel?.push(new Progress([dec.decode(bytes)], {}, { progress: true }))
    }
  }
  tab.pendingInputs = []
}

function resetEncryptionState(tab: TabState) {
  tab.encKeys = null
  tab.encryptionMode = 'pending'
  tab.shellId = ''
  tab.clientPrivateKey = null
  tab.clientPublicKey = null
  tab.pendingInputs = []
  tab.isFirstSizeSent = false
}

function cleanupTab(tab: TabState) {
  if (tab.closed) return
  tab.closed = true
  tab.term?.dispose()
  // Non-progress frame unblocks the sender; without it the call lingers on the cached session.
  // Pass the shell ID so the server routes cleanup to the correct PTY (not the caller-default).
  tab.channel?.push(new Progress(tab.shellId ? [tab.shellId] : [], {}, {}))
  tab.channel = null
  tab.session = null
}

async function startShell(tab: TabState) {
  if (!tab.session || !tab.channel) return

  let firstServerMessage = true
  const pendingOutput: Uint8Array[] = []

  try {
    await tab.session.callProgressiveProgress(
      'io.xconn.deskconn.deskconnd.shell',
      async () => tab.channel!.next(),
      async (progressResult: Result) => {
        if (tab.closed) return
        const args = progressResult.args
        if (!args || args.length === 0) {
          closeTab(tab.id)
          return
        }

        const raw = args[0]
        const data: Uint8Array =
          raw instanceof Uint8Array ? raw : enc.encode(typeof raw === 'string' ? raw : String(raw))

        if (firstServerMessage) {
          firstServerMessage = false
          const keyPrefix = enc.encode('KEY:')
          const startsWithKey =
            data.length > keyPrefix.length &&
            data.slice(0, keyPrefix.length).every((b, i) => b === keyPrefix[i])

          if (startsWithKey) {
            // X25519 public key is always 32 bytes. For non-first shells the server
            // appends the assigned shell ID after the key; capture it so we can
            // prefix every outgoing frame with "<shellId>:" for server-side routing.
            const afterKey = data.slice(keyPrefix.length)
            const serverPublicKey = afterKey.slice(0, 32)
            if (afterKey.length > 32) {
              tab.shellId = dec.decode(afterKey.slice(32))
            }
            // deriveSessionKeys is async — frames that arrive during this await are
            // buffered in pendingOutput and flushed below once keys are ready.
            tab.encKeys = await deriveSessionKeys(tab.clientPrivateKey!, serverPublicKey)
            tab.encryptionMode = 'enabled'
            for (const buffered of pendingOutput) {
              tab.term?.write(decryptPayload(buffered, tab.encKeys.decryptKey))
            }
            pendingOutput.length = 0
          } else {
            tab.encryptionMode = 'disabled'
            tab.term?.write(data)
            for (const buffered of pendingOutput) tab.term?.write(buffered)
            pendingOutput.length = 0
          }

          flushPendingInputs(tab)
          return
        }

        // Key derivation still in progress — buffer until encryption mode is known.
        if (tab.encryptionMode === 'pending') {
          pendingOutput.push(data)
          return
        }

        if (tab.encryptionMode === 'enabled' && tab.encKeys) {
          tab.term?.write(decryptPayload(data, tab.encKeys.decryptKey))
        } else {
          tab.term?.write(data)
        }
      },
    )
  } catch (err) {
    if (tab.closed) return
    if (err instanceof ApplicationError) {
      tab.term?.write(`Desktop is offline.`)
    } else {
      tab.term?.write(`Shell error: ${err}`)
    }
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

  resetEncryptionState(tab)
  const kp = createX25519KeyPair()
  tab.clientPrivateKey = kp.privateKey
  tab.clientPublicKey = kp.publicKey

  tab.channel = new ProgressChannel()
  tab.term.onData((data) => handleTerminalInput(tab, data))
  tab.term.onTitleChange((title) => {
    if (tab.closed || !title) return
    tab.label = title
    tabs.value = [...tabs.value]
  })
  handleResizeTab(tab)

  await startShell(tab)
}

async function addTab() {
  const tab = createTabState()
  tabs.value = [...tabs.value, tab]
  activeTabId.value = tab.id
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await initTab(tab)
}

async function switchTab(id: number) {
  if (activeTabId.value === id) return
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

const closePanel = () => {
  for (const tab of tabs.value) cleanupTab(tab)
  unlockPageScroll()
  emit('close')
}

const updateKeybarPosition = () => {
  requestAnimationFrame(() => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const panelTop = panelRef.value?.getBoundingClientRect().top ?? 0
    panelViewportHeight.value = Math.max(0, viewportHeight - Math.max(panelTop, 0))
    keybarHeight.value = keybarRef.value?.offsetHeight ?? keybarHeight.value
  })
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

onMounted(async () => {
  if (isMobile.value) {
    lockPageScroll()
  }

  window.addEventListener('resize', handleResize)
  window.visualViewport?.addEventListener('resize', updateKeybarPosition)
  window.visualViewport?.addEventListener('scroll', updateKeybarPosition)
  await nextTick()
  observeKeybarHeight()
  updateKeybarPosition()

  await addTab()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.visualViewport?.removeEventListener('resize', updateKeybarPosition)
  window.visualViewport?.removeEventListener('scroll', updateKeybarPosition)
  keybarResizeObserver?.disconnect()
  keybarResizeObserver = null
  clearTerminalTouchScroll()
  unlockPageScroll()
  for (const tab of tabs.value) cleanupTab(tab)
})

watch([terminalInsetBottom, panelViewportHeight], () => {
  requestAnimationFrame(() => {
    handleResize()
  })
})
</script>

<template>
  <div ref="panelRef" class="terminal-panel" :style="terminalPanelStyle">
    <WindowTitleBar @close="closePanel">
      <i class="bi bi-terminal"></i>
      <span>{{ desktopName }}</span>
    </WindowTitleBar>

    <div class="tab-bar">
      <div class="tabs-list">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-item"
          :class="{ 'tab-active': tab.id === activeTabId }"
          @click="switchTab(tab.id)"
        >
          <i class="bi bi-terminal-fill tab-icon"></i>
          <span class="tab-label">{{ tab.label }}</span>
          <span
            class="tab-close"
            role="button"
            :title="`Close ${tab.label}`"
            @click.stop="closeTab(tab.id)"
          >&times;</span>
        </button>
        <button class="tab-add" title="New terminal" @click="addTab">+</button>
      </div>
    </div>

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

.tab-bar {
  display: flex;
  align-items: stretch;
  background: #141414;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
  overflow: hidden;
}

.tabs-list {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.tab-item {
  flex: 0 1 180px;
  min-width: 40px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px 0 10px;
  height: 32px;
  background: #141414;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  color: #666;
  font-size: 0.72rem;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.12s, color 0.12s;
}

.tab-item:hover {
  background: #1e1e1e;
  color: #aaa;
}

.tab-item.tab-active {
  background: #1e1e1e;
  color: #e2e8f0;
  box-shadow: inset 0 2px 0 #3b82f6;
}

.tab-icon {
  font-size: 0.65rem;
  flex-shrink: 0;
  opacity: 0.7;
}

.tab-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.tab-close {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  border-radius: 3px;
  color: inherit;
  font-size: 0.9rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
  user-select: none;
}

.tab-item:hover .tab-close,
.tab-item.tab-active .tab-close {
  opacity: 0.5;
}

.tab-close:hover {
  opacity: 1 !important;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 3px;
}

.tab-add {
  flex: 0 0 28px;
  height: 32px;
  background: transparent;
  border: none;
  color: #555;
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  border-radius: 3px;
  margin: 2px 2px 2px 1px;
}

.tab-add:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
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
