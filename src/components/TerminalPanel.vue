<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ApplicationError, Progress, Result, Session } from 'xconn'
import { useAuthStore } from '@/stores/auth'
import {
  createX25519KeyPair,
  deriveSessionKeys,
  encryptPayload,
  decryptPayload,
} from '@/utils/encryption'

const props = defineProps<{ realm: string; desktopName: string }>()
const emit = defineEmits<{ close: [] }>()

const authStore = useAuthStore()
const panelRef = ref<HTMLDivElement | null>(null)
const terminalRef = ref<HTMLDivElement | null>(null)
const keybarRef = ref<HTMLDivElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let session: Session | null = null
let channel: ProgressChannel | null = null
let closed = false
let keybarResizeObserver: ResizeObserver | null = null
let previousBodyOverflow = ''
let previousHtmlOverflow = ''
let previousBodyOverscrollBehavior = ''
let previousHtmlOverscrollBehavior = ''
let touchScrollLastY: number | null = null

// Encryption state — reset on each startShell call
let encKeys: { encryptKey: Uint8Array; decryptKey: Uint8Array } | null = null
let encryptionMode: 'pending' | 'enabled' | 'disabled' = 'pending'
let clientPrivateKey: Uint8Array | null = null
let clientPublicKey: Uint8Array | null = null
let pendingInputs: Uint8Array[] = []
let isFirstSizeSent = false

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

function pushEncrypted(bytes: Uint8Array) {
  if (!channel) return
  const payload = encKeys ? encryptPayload(bytes, encKeys.encryptKey) : bytes
  channel.push(new Progress([payload], {}, { progress: true }))
}

const sendSize = () => {
  if (!term || !channel) return
  const { cols, rows } = term
  const sizeStr = `SIZE:${cols}:${rows}`

  if (!isFirstSizeSent) {
    isFirstSizeSent = true
    // First SIZE: append :KEY:<publicKey> for key exchange
    const sizeBytes = enc.encode(sizeStr)
    const keyMarker = enc.encode(':KEY:')
    const first = new Uint8Array(sizeBytes.length + keyMarker.length + clientPublicKey!.length)
    first.set(sizeBytes, 0)
    first.set(keyMarker, sizeBytes.length)
    first.set(clientPublicKey!, sizeBytes.length + keyMarker.length)
    channel.push(new Progress([first], {}, { progress: true }))
    return
  }

  // Subsequent resizes: encrypt if encryption is active, otherwise send as string
  if (encryptionMode === 'enabled') {
    pushEncrypted(enc.encode(sizeStr))
  } else if (encryptionMode === 'disabled') {
    channel.push(new Progress([sizeStr], {}, { progress: true }))
  }
  // If still 'pending', drop the resize — the terminal isn't active yet
}

const handleResize = () => {
  if (!fitAddon) return
  fitAddon.fit()
  sendSize()
}

const handleTerminalInput = (data: string) => {
  if (closed || !channel) return

  let input = data
  if (ctrlActive.value && data.length === 1) {
    const code = data.toUpperCase().charCodeAt(0) - 64
    input = code > 0 && code < 32 ? String.fromCharCode(code) : data
    ctrlActive.value = false
  }

  const bytes = enc.encode(input)
  if (encryptionMode === 'pending') {
    pendingInputs.push(bytes)
    return
  }
  if (encryptionMode === 'enabled') {
    pushEncrypted(bytes)
  } else {
    channel.push(new Progress([input], {}, { progress: true }))
  }
}

function flushPendingInputs() {
  for (const bytes of pendingInputs) {
    if (encryptionMode === 'enabled') {
      pushEncrypted(bytes)
    } else {
      channel?.push(new Progress([dec.decode(bytes)], {}, { progress: true }))
    }
  }
  pendingInputs = []
}

function resetEncryptionState() {
  encKeys = null
  encryptionMode = 'pending'
  clientPrivateKey = null
  clientPublicKey = null
  pendingInputs = []
  isFirstSizeSent = false
}

const cleanup = () => {
  if (closed) return
  closed = true
  window.removeEventListener('resize', handleResize)
  window.visualViewport?.removeEventListener('resize', updateKeybarPosition)
  window.visualViewport?.removeEventListener('scroll', updateKeybarPosition)
  keybarResizeObserver?.disconnect()
  keybarResizeObserver = null
  clearTerminalTouchScroll()
  unlockPageScroll()
  term?.dispose()
  session?.leave().catch(console.error)
  session = null
}

const startShell = async () => {
  if (!session || !channel) return

  let firstServerMessage = true

  try {
    await session.callProgressiveProgress(
      'io.xconn.deskconn.deskconnd.shell',
      async () => channel!.next(),
      async (progressResult: Result) => {
        const args = progressResult.args
        if (!args || args.length === 0) {
          channel?.push(new Progress([], {}, {}))
          cleanup()
          emit('close')
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
            const serverPublicKey = data.slice(keyPrefix.length)
            encKeys = await deriveSessionKeys(clientPrivateKey!, serverPublicKey)
            encryptionMode = 'enabled'
          } else {
            // Old server: no encryption
            encryptionMode = 'disabled'
            term?.write(data)
          }

          flushPendingInputs()
          return
        }

        if (encryptionMode === 'enabled' && encKeys) {
          const plaintext = decryptPayload(data, encKeys.decryptKey)
          term?.write(plaintext)
        } else {
          term?.write(data)
        }
      },
    )
  } catch (err) {
    if (err instanceof ApplicationError) {
      term?.write(`Desktop is offline.`)
    } else {
      term?.write(`Shell error: ${err}`)
    }
  }
}

const closePanel = () => {
  cleanup()
  emit('close')
}

// Mobile keyboard toolbar
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
  if (!isMobile.value || !term || event.touches.length !== 1 || touchScrollLastY === null) return

  const touch = event.touches.item(0)
  if (!touch) return

  const nextY = touch.clientY
  const deltaY = nextY - touchScrollLastY
  if (Math.abs(deltaY) < 4) return

  event.preventDefault()
  term.scrollLines(Math.round(-deltaY / 16))
  touchScrollLastY = nextY
}

const pressMobileKey = (seq: string, label: string) => {
  setKeyPressed(label, true)
  triggerHapticFeedback()
  if (label === 'CTRL') {
    ctrlActive.value = !ctrlActive.value
    return
  }
  handleTerminalInput(seq)
  term?.focus()
}

const releaseMobileKey = (label: string) => {
  setKeyPressed(label, false)
}

onMounted(async () => {
  if (!terminalRef.value) return

  if (isMobile.value) {
    lockPageScroll()
  }

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    convertEol: true,
    scrollback: 10000,
    fontSize: 14,
    theme: { background: '#1e1e1e' },
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalRef.value)
  fitAddon.fit()

  // Set up listeners before focus so the keyboard-open resize fires into them
  window.addEventListener('resize', handleResize)
  window.visualViewport?.addEventListener('resize', updateKeybarPosition)
  window.visualViewport?.addEventListener('scroll', updateKeybarPosition)
  await nextTick()
  observeKeybarHeight()
  updateKeybarPosition()

  term.focus()

  try {
    session = await authStore.shell(props.realm)
  } catch {
    term.writeln('Connection failed.')
  }

  resetEncryptionState()
  const kp = createX25519KeyPair()
  clientPrivateKey = kp.privateKey
  clientPublicKey = kp.publicKey

  channel = new ProgressChannel()
  term.onData(handleTerminalInput)
  handleResize()

  await startShell()
})

onUnmounted(cleanup)

watch([terminalInsetBottom, panelViewportHeight], () => {
  requestAnimationFrame(() => {
    handleResize()
  })
})
</script>

<template>
  <div ref="panelRef" class="terminal-panel" :style="terminalPanelStyle">
    <div class="terminal-titlebar">
      <div class="terminal-title">
        <i class="bi bi-terminal me-2"></i>
        <span>{{ desktopName }}</span>
      </div>
      <div class="terminal-actions">
        <button class="tbar-btn tbar-close" title="Close" @click="closePanel">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
    <div
      ref="terminalRef"
      class="terminal-body"
      @touchstart="handleTerminalTouchStart"
      @touchmove="handleTerminalTouchMove"
      @touchend="clearTerminalTouchScroll"
      @touchcancel="clearTerminalTouchScroll"
    ></div>
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

.terminal-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  height: 38px;
  background: #2d2d2d;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  user-select: none;
}

.terminal-title {
  display: flex;
  align-items: center;
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 500;
  gap: 0.25rem;
}

.terminal-actions {
  display: flex;
  gap: 0.25rem;
}

.tbar-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0.3rem 0.4rem;
  border-radius: 5px;
  font-size: 0.8rem;
  line-height: 1;
  display: flex;
  align-items: center;
  transition:
    color 0.15s,
    background 0.15s;
}

.tbar-btn:hover {
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.1);
}

.tbar-close:hover {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.2);
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
