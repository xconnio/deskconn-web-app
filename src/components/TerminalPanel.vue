<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
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
const terminalRef = ref<HTMLDivElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let session: Session | null = null
let channel: ProgressChannel | null = null
let closed = false

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
  const bytes = enc.encode(data)
  if (encryptionMode === 'pending') {
    pendingInputs.push(bytes)
    return
  }
  if (encryptionMode === 'enabled') {
    pushEncrypted(bytes)
  } else {
    channel.push(new Progress([data], {}, { progress: true }))
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

onMounted(async () => {
  if (!terminalRef.value) return

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
  window.addEventListener('resize', handleResize)
  handleResize()

  await startShell()
})

onUnmounted(cleanup)
</script>

<template>
  <div class="terminal-panel">
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
    <div ref="terminalRef" class="terminal-body"></div>
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
  transition: color 0.15s, background 0.15s;
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
}
</style>
