<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ApplicationError, Progress, Result, Session } from 'xconn'

import { useAuthStore } from '@/stores/auth'

const procedureShell = 'io.xconn.deskconn.deskconnd.shell'

const route = useRoute()
const authStore = useAuthStore()
const realm = route.params.realm as string

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
    if (this.queue.length > 0) {
      return this.queue.shift()!
    }

    return new Promise((resolve) => {
      this.waiting = resolve
    })
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

const closeShell = async (reason?: string) => {
  if (closed) return
  closed = true

  try {
    // Stop sender loop safely
    channel?.push(new Progress([], {}, {}))
  } catch {}

  window.removeEventListener('resize', handleResize)

  try {
    await session?.leave()
  } catch (err) {
    console.error('Error leaving session:', err)
  }

  if (term) {
    if (reason) {
      term.writeln(`\r\n${reason}`)
    }
    term.writeln('\r\nSession closed.')
  }
}

const startShell = async () => {
  if (!session || !channel) return

  try {
    await session.callProgressiveProgress(
      procedureShell,
      async () => channel!.next(),
      async (progressResult: Result) => {
        const args = progressResult.args
        if (args && args.length > 0 && term) {
          term.write(args[0])
        } else {
          channel!.push(new Progress([], {}, {}))
          await closeShell('Remote shell ended.')
        }
      },
    )
  } catch (err) {
    if (err instanceof ApplicationError) {
      console.error('Shell error:', err)
      term?.write(`Desktop is offline.`)
    } else {
      console.error('Shell error:', err)
      term?.write(`Shell error: ${err}`)
    }
  }
}

onMounted(async () => {
  if (!terminalRef.value) return

  term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    fontSize: 15,
    theme: { background: '#1e1e1e' },
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  term.open(terminalRef.value)
  fitAddon.fit()

  term.writeln('Starting shell ...')

  try {
    session = await authStore.shell(realm)
  } catch (err) {
    console.error(err)
    term.writeln('Connection failed.')
    return
  }

  channel = new ProgressChannel()

  term.onData(handleTerminalInput)

  window.addEventListener('resize', handleResize)
  handleResize()

  await startShell()
})

onUnmounted(() => {
  closed = true
  window.removeEventListener('resize', handleResize)
  session?.leave().catch(console.error)
})
</script>

<template>
  <div class="terminal-wrapper">
    <div ref="terminalRef" class="terminal"></div>
  </div>
</template>

<style>
html,
body {
  height: 100%;
  margin: 0;
}

.terminal-wrapper {
  width: 100vw;
  height: 100vh;
  background: #1e1e1e;
}

.terminal {
  width: 100%;
  height: 100%;
}
</style>
