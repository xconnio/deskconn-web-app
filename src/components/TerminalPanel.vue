<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ApplicationError, Progress, Result, Session } from 'xconn'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ realm: string; desktopName: string }>()
const emit = defineEmits<{ close: [] }>()

const authStore = useAuthStore()
const terminalRef = ref<HTMLDivElement | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let session: Session | null = null
let channel: ProgressChannel | null = null
let closed = false

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

const sendSize = () => {
  if (!term || !channel) return
  const { cols, rows } = term
  channel.push(new Progress([`SIZE:${cols}:${rows}`], {}, { progress: true }))
}

const handleResize = () => {
  if (!fitAddon) return
  fitAddon.fit()
  sendSize()
}

const handleTerminalInput = (data: string) => {
  if (closed || !channel) return
  channel.push(new Progress([data], {}, { progress: true }))
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
  try {
    await session.callProgressiveProgress(
      'io.xconn.deskconn.deskconnd.shell',
      async () => channel!.next(),
      async (progressResult: Result) => {
        const args = progressResult.args
        if (args && args.length > 0 && term) {
          term.write(args[0])
        } else {
          channel?.push(new Progress([], {}, {}))
          cleanup()
          emit('close')
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
