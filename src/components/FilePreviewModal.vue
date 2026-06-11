<script setup lang="ts">
/**
 * Standalone file preview + download modal.
 * Accepts an established session and a file entry; downloads and previews the
 * file using the exact same protocol as EmbeddedDesktopFiles (per-file key
 * exchange, H/D framing, MediaSource streaming for audio/video).
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { type Session } from 'xconn'
import { createX25519KeyPair, deriveSessionKeys, decryptPayload } from '@/utils/encryption'
import {
  type FilePreviewType,
  formatSize,
  getFilePreviewType,
  getMimeType,
  getMSEMimeType,
  isFirefoxBrowser,
} from '@/utils/fileTypes'

const procedureFileDownload = 'io.xconn.deskconn.deskconnd.file.download'

const props = defineProps<{
  session: Session
  entry: { path: string; name: string; size: number }
}>()

const emit = defineEmits<{ close: [] }>()

const previewType          = ref<FilePreviewType>('none')
const previewBlobUrl       = ref('')
const previewTextContent   = ref('')
const previewLoading       = ref(false)
const previewError         = ref('')
const previewTheater       = ref(false)
const previewFullscreen    = ref(false)
const previewExpectedBytes = ref(0)
const previewReceivedBytes = ref(0)
const previewBodyEl        = ref<HTMLElement | null>(null)
const previewDialogEl      = ref<HTMLElement | null>(null)
const mediaRetryUsed       = ref(false)

type DownloadProgressState = { name: string; received: number; total: number; speed: number; cancel: () => void }
const downloadProgress = ref<DownloadProgressState | null>(null)

let downloadServiceWorker: ServiceWorker | null = null
let downloadServiceWorkerReadyPromise: Promise<ServiceWorker | null> | null = null
let mounted = true

function scrollPreviewBody(e: WheelEvent) {
  const body = previewBodyEl.value
  if (!body) return
  const child = Array.from(body.children).find(
    (el) => (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight,
  ) as HTMLElement | undefined
  ;(child ?? body).scrollTop += e.deltaY
}

type CallResult = Awaited<ReturnType<Session['call']>>

async function streamFileData(
  remotePath: string,
  onChunk: (chunk: Uint8Array, expectedTotal: number) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const LATE_PROGRESS_WAIT_MS = 250
  const MAX_LATE_PROGRESS_WAIT_MS = 5_000

  const { publicKey, privateKey } = createX25519KeyPair()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progressResult: any = await props.session.callProgress(procedureFileDownload, [remotePath, false, publicKey])

  const queue: CallResult[] = []
  let wakeUp: (() => void) | null = null
  let streamDone = false
  let streamError: unknown = null

  const notify = () => { const fn = wakeUp; wakeUp = null; fn?.() }
  progressResult.registerProgress((result: CallResult) => { queue.push(result); notify() })
  progressResult.finalResultPromise
    .then(() => { streamDone = true; notify() })
    .catch((err: unknown) => { streamError = err; streamDone = true; notify() })

  let receiveKey: Uint8Array | null = null
  let firstMessage = true
  let expectedTotal = 0
  let receivedTotal = 0
  let lateProgressWaitedMs = 0

  const onAbort = () => notify()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) throw new Error('cancelled')
      if (queue.length === 0) {
        if (streamDone) {
          if (expectedTotal > 0 && receivedTotal < expectedTotal) {
            await new Promise<void>((resolve) => {
              let settled = false
              const timer = window.setTimeout(() => { if (settled) return; settled = true; wakeUp = null; resolve() }, LATE_PROGRESS_WAIT_MS)
              wakeUp = () => { if (settled) return; settled = true; window.clearTimeout(timer); wakeUp = null; resolve() }
            })
            if (queue.length > 0) { lateProgressWaitedMs = 0; continue }
            lateProgressWaitedMs += LATE_PROGRESS_WAIT_MS
            if (lateProgressWaitedMs < MAX_LATE_PROGRESS_WAIT_MS) continue
            throw new Error(`Download stream ended early (${receivedTotal} of ${expectedTotal} bytes)`)
          }
          break
        }
        await new Promise<void>(resolve => { wakeUp = resolve })
        continue
      }
      const result = queue.shift()!
      const args = (result.args ?? []) as unknown[]
      if (firstMessage) {
        firstMessage = false
        const raw = args[0] as Uint8Array
        if (raw.length < 36) throw new Error('Invalid key exchange message from server')
        receiveKey = (await deriveSessionKeys(privateKey, raw.slice(4))).decryptKey
        continue
      }
      if (!receiveKey || args.length < 2) continue
      const msgType = args[0]
      if (typeof msgType !== 'string') continue
      if (msgType === 'H') {
        const plain = decryptPayload(args[1] as Uint8Array, receiveKey)
        expectedTotal = (JSON.parse(new TextDecoder().decode(plain)) as { size?: number }).size ?? 0
      } else if (msgType === 'D') {
        const chunk = decryptPayload(args[1] as Uint8Array, receiveKey)
        receivedTotal += chunk.length
        await onChunk(chunk, expectedTotal)
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  if (streamError) throw streamError instanceof Error ? streamError : new Error('Stream failed')
}

async function fetchFileData(remotePath: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  await streamFileData(remotePath, (chunk, expectedTotal) => {
    chunks.push(chunk)
    total += chunk.length
    previewExpectedBytes.value = expectedTotal
    previewReceivedBytes.value = total
  })
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
  return combined
}

async function openWithMediaSource(mseMime: string): Promise<boolean> {
  const mediaSource = new MediaSource()
  const blobUrl = URL.createObjectURL(mediaSource)

  previewType.value = getFilePreviewType(props.entry.name) as FilePreviewType
  previewBlobUrl.value = blobUrl
  previewLoading.value = false
  previewExpectedBytes.value = props.entry.size
  previewReceivedBytes.value = 0
  previewError.value = ''

  const queue: Uint8Array[] = []
  let isAppending = false
  let streamDone = false
  let sourceBuffer: SourceBuffer | null = null
  const sourceAbort = new AbortController()

  function drainQueue() {
    if (!sourceBuffer || isAppending || mediaSource.readyState !== 'open') return
    if (queue.length === 0) {
      if (streamDone) { try { mediaSource.endOfStream() } catch { /* already ended */ } }
      return
    }
    isAppending = true
    try { sourceBuffer.appendBuffer(queue.shift()!.slice()) } catch { isAppending = false }
  }

  await new Promise<void>(resolve => {
    mediaSource.addEventListener('sourceopen', () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mseMime)
        sourceBuffer.addEventListener('updateend', () => { isAppending = false; drainQueue() })
        sourceBuffer.addEventListener('error', () => { isAppending = false; sourceAbort.abort() })
      } catch { /* unsupported at runtime */ }
      resolve()
    }, { once: true })
  })

  if (!sourceBuffer) {
    URL.revokeObjectURL(blobUrl)
    try { mediaSource.endOfStream() } catch { /* ignore */ }
    previewBlobUrl.value = ''
    return false
  }

  try {
    await streamFileData(props.entry.path, (chunk, expectedTotal) => {
      if (!mounted) return
      if (expectedTotal > 0) previewExpectedBytes.value = expectedTotal
      previewReceivedBytes.value += chunk.length
      queue.push(chunk)
      drainQueue()
    }, sourceAbort.signal)
    streamDone = true
    drainQueue()
  } catch (err) {
    if (sourceAbort.signal.aborted) return false
    if (mounted) previewError.value = err instanceof Error ? err.message : 'Failed to stream file'
  }
  return true
}

async function openFile(isRetry = false) {
  if (!isRetry) mediaRetryUsed.value = false
  const pt = getFilePreviewType(props.entry.name)
  const MAX_IMG_PDF = 100 * 1024 * 1024
  const MAX_AUDIO_FALLBACK = 50 * 1024 * 1024
  const MAX_VIDEO_FALLBACK = 200 * 1024 * 1024

  if (pt === 'none' || (pt === 'text' && props.entry.size > 5 * 1024 * 1024)) {
    await downloadFileToClient(); return
  }
  if ((pt === 'image' || pt === 'pdf') && props.entry.size > MAX_IMG_PDF) {
    await downloadFileToClient(); return
  }
  if (pt === 'audio' || pt === 'video') {
    const mseMime = !isRetry ? getMSEMimeType(props.entry.name) : null
    if (mseMime) {
      if (previewBlobUrl.value) { URL.revokeObjectURL(previewBlobUrl.value); previewBlobUrl.value = '' }
      const ok = await openWithMediaSource(mseMime)
      if (ok) return
    }
    const limit = pt === 'audio' ? MAX_AUDIO_FALLBACK : MAX_VIDEO_FALLBACK
    if (props.entry.size > limit) { await downloadFileToClient(); return }
  }

  if (previewBlobUrl.value) { URL.revokeObjectURL(previewBlobUrl.value); previewBlobUrl.value = '' }
  previewType.value = pt
  previewLoading.value = true
  previewExpectedBytes.value = props.entry.size
  previewReceivedBytes.value = 0
  previewError.value = ''

  try {
    const data = await fetchFileData(props.entry.path)
    if (!mounted) return
    if (pt === 'text') {
      previewTextContent.value = new TextDecoder('utf-8', { fatal: false }).decode(data)
    } else {
      const blob = new Blob([data.slice()], { type: getMimeType(props.entry.name) })
      previewBlobUrl.value = URL.createObjectURL(blob)
    }
  } catch (err) {
    if (mounted) previewError.value = err instanceof Error ? err.message : 'Failed to load file'
  } finally {
    if (mounted) previewLoading.value = false
  }
}

function handleMediaError(event: Event) {
  const media = event.target as HTMLMediaElement
  if (!media.error) return
  if (!mediaRetryUsed.value) { mediaRetryUsed.value = true; openFile(true) }
  else previewError.value = 'This file could not be played. Use the Download button above.'
}

function downloadFromPreview() {
  if (previewType.value === 'audio' || previewType.value === 'video') {
    downloadFileToClient(); return
  }
  if (previewBlobUrl.value) {
    const a = document.createElement('a')
    a.href = previewBlobUrl.value
    a.download = props.entry.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } else if (previewTextContent.value) {
    const blob = new Blob([previewTextContent.value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = props.entry.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } else {
    downloadFileToClient()
  }
}

async function downloadFileToClient() {
  const STALL_MS = 20_000
  const controller = new AbortController()
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stalledOut = false

  function armStall() {
    if (stallTimer !== null) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => { stalledOut = true; controller.abort() }, STALL_MS)
  }
  function clearStall() {
    if (stallTimer !== null) { clearTimeout(stallTimer); stallTimer = null }
  }
  function onError(err: unknown) {
    if (stalledOut) return
    if (!controller.signal.aborted && err instanceof Error) console.warn('Download failed:', err.message)
  }

  if (!isFirefoxBrowser() && 'showSaveFilePicker' in window) {
    await downloadFileWithSavePicker(controller, armStall, clearStall, onError); return
  }
  try {
    await downloadFileWithBrowserDownload(controller.signal, armStall, clearStall)
  } catch (err) {
    clearStall(); onError(err)
  }
}

async function downloadFileWithSavePicker(
  controller: AbortController,
  armStall: () => void,
  clearStall: () => void,
  onError: (err: unknown) => void,
) {
  let writable: FileSystemWritableFileStream | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showSaveFilePicker({ suggestedName: props.entry.name })
    writable = await handle.createWritable()
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return
    return
  }

  const startTime = Date.now()
  let received = 0
  downloadProgress.value = { name: props.entry.name, received: 0, total: props.entry.size, speed: 0, cancel: () => controller.abort() }
  armStall()

  try {
    await streamFileData(props.entry.path, async (chunk, expectedTotal) => {
      armStall()
      await writable!.write(chunk.slice())
      received += chunk.length
      if (!downloadProgress.value) return
      downloadProgress.value.received = received
      if (expectedTotal > 0) downloadProgress.value.total = expectedTotal
      const elapsed = (Date.now() - startTime) / 1000
      downloadProgress.value.speed = elapsed > 0 ? received / elapsed : 0
    }, controller.signal)
    await writable!.close()
  } catch (err) {
    try { await writable?.abort() } catch { /* ignore */ }
    onError(err)
  } finally {
    clearStall(); downloadProgress.value = null
  }
}

async function downloadFileWithBrowserDownload(
  signal: AbortSignal,
  armStall: () => void,
  clearStall: () => void,
) {
  armStall()
  const sw = downloadServiceWorker ?? await ensureDownloadServiceWorker()
  if (!sw) throw new Error('Browser downloads are not available in this browser')

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let sentMeta = false
  let pendingPulls = 0
  let bridgeError: Error | null = null
  let pullWaiter: (() => void) | null = null
  const mc = new MessageChannel()
  const keepAlive = window.setInterval(() => sw.postMessage({ type: 'ping', id }), 10_000)

  function resolvePull() {
    if (pullWaiter) { const r = pullWaiter; pullWaiter = null; r(); return }
    pendingPulls++
  }
  function waitForPull() {
    if (bridgeError) return Promise.reject(bridgeError)
    if (pendingPulls > 0) { pendingPulls--; return Promise.resolve() }
    return new Promise<void>((resolve, reject) => {
      pullWaiter = () => { if (bridgeError) reject(bridgeError); else resolve() }
    })
  }

  mc.port1.onmessage = (event) => {
    const data = event.data ?? {}
    if (data.type === 'pull') { resolvePull(); return }
    if (data.type === 'error') {
      bridgeError = new Error(data.message || 'Download bridge failed')
      if (pullWaiter) { const r = pullWaiter; pullWaiter = null; r() }
    }
  }
  sw.postMessage({ type: 'download', id, filename: props.entry.name }, [mc.port2])

  const a = document.createElement('a')
  a.href = `/_dl/${id}`; a.download = props.entry.name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)

  try {
    await streamFileData(props.entry.path, async (chunk, expectedTotal) => {
      armStall()
      if (!sentMeta) {
        mc.port1.postMessage({ type: 'meta', filename: props.entry.name, size: expectedTotal > 0 ? expectedTotal : 0 })
        sentMeta = true
      }
      await waitForPull()
      if (bridgeError) throw bridgeError
      const payload = chunk.slice().buffer
      mc.port1.postMessage({ type: 'chunk', chunk: payload }, [payload])
    }, signal)
    mc.port1.postMessage({ type: 'close' })
  } catch (err) {
    mc.port1.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'Download failed' })
    throw err
  } finally {
    window.clearInterval(keepAlive); clearStall()
  }
}

async function ensureDownloadServiceWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null
  if (downloadServiceWorker) return downloadServiceWorker
  if (!downloadServiceWorkerReadyPromise) {
    downloadServiceWorkerReadyPromise = (async () => {
      await navigator.serviceWorker.register('/sw-download.js', { scope: '/' })
      await navigator.serviceWorker.ready
      if (navigator.serviceWorker.controller) {
        downloadServiceWorker = navigator.serviceWorker.controller
        return downloadServiceWorker
      }
      downloadServiceWorker = await new Promise<ServiceWorker>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (navigator.serviceWorker.controller) resolve(navigator.serviceWorker.controller)
        }, { once: true })
      })
      return downloadServiceWorker
    })().catch((err) => { downloadServiceWorkerReadyPromise = null; throw err })
  }
  return downloadServiceWorkerReadyPromise
}

function toggleTheater() {
  previewTheater.value = !previewTheater.value
}

async function toggleFullscreen() {
  const el = previewDialogEl.value
  if (!el) return
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {})
  } else {
    await el.requestFullscreen().catch(() => {})
  }
}

function handleFullscreenChange() {
  previewFullscreen.value = document.fullscreenElement === previewDialogEl.value
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (document.fullscreenElement) return // let the browser exit fullscreen first
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  openFile()
})

onUnmounted(() => {
  mounted = false
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (document.fullscreenElement === previewDialogEl.value) void document.exitFullscreen().catch(() => {})
  if (previewBlobUrl.value) URL.revokeObjectURL(previewBlobUrl.value)
})
</script>

<template>
  <Teleport to="body">
  <div class="preview-overlay fs-overlay" @click.self="emit('close')" @wheel.self.prevent="scrollPreviewBody">
    <div ref="previewDialogEl" class="preview-dialog" :class="{ 'preview-dialog--theater': previewTheater }">

      <div class="preview-header">
        <span class="preview-title">{{ entry.name }}</span>
        <div class="preview-header-actions">
          <button class="preview-close-btn" @click="downloadFromPreview" :disabled="previewLoading" title="Download">
            <i class="bi bi-download"></i>
          </button>
          <button
            v-if="!previewFullscreen"
            class="preview-close-btn"
            :class="{ 'preview-action-active': previewTheater }"
            @click="toggleTheater"
            :title="previewTheater ? 'Exit theater mode' : 'Theater mode'"
          >
            <i class="bi bi-aspect-ratio"></i>
          </button>
          <button class="preview-close-btn" @click="toggleFullscreen" :title="previewFullscreen ? 'Exit full screen' : 'Full screen'">
            <i class="bi" :class="previewFullscreen ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'"></i>
          </button>
          <button class="preview-close-btn" @click="emit('close')" title="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      <div class="preview-body" ref="previewBodyEl">
        <div v-if="previewLoading" class="preview-state">
          <div class="spinner-border mb-3" role="status"><span class="visually-hidden">Loading…</span></div>
          <p v-if="previewExpectedBytes > 0" class="preview-progress-text">
            {{ formatSize(previewReceivedBytes) }} / {{ formatSize(previewExpectedBytes) }}
          </p>
          <p v-else class="preview-progress-text">Loading…</p>
        </div>

        <div v-else-if="previewError" class="preview-state">
          <i class="bi bi-exclamation-octagon display-6 mb-3"></i>
          <p class="mb-0">{{ previewError }}</p>
        </div>

        <div v-else-if="previewType === 'image' && previewBlobUrl" class="preview-image-wrap">
          <img :src="previewBlobUrl" :alt="entry.name" class="preview-image" />
        </div>

        <div v-else-if="previewType === 'audio' && previewBlobUrl" class="preview-audio-wrap">
          <div class="audio-icon"><i class="bi bi-music-note-beamed"></i></div>
          <p class="audio-name">{{ entry.name }}</p>
          <audio :src="previewBlobUrl" controls class="preview-audio" @error="handleMediaError" />
        </div>

        <div v-else-if="previewType === 'video' && previewBlobUrl" class="preview-video-wrap">
          <video :src="previewBlobUrl" controls class="preview-video" @error="handleMediaError" />
        </div>

        <div v-else-if="previewType === 'pdf' && previewBlobUrl" class="preview-pdf-wrap">
          <iframe :src="previewBlobUrl" class="preview-pdf" />
        </div>

        <div v-else-if="previewType === 'text'" class="preview-text-wrap">
          <pre class="preview-text">{{ previewTextContent }}</pre>
        </div>
      </div>
    </div>
  </div>

  <!-- Download progress toast -->
  <Transition name="dl-toast">
    <div v-if="downloadProgress" class="dl-toast">
      <div class="dl-toast-header">
        <i class="bi bi-download dl-toast-icon"></i>
        <span class="dl-toast-title">Downloading</span>
        <button class="dl-toast-cancel" @click="downloadProgress.cancel()" title="Cancel">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="dl-toast-name">{{ downloadProgress.name }}</div>
      <div class="dl-progress-bar-wrap">
        <div class="dl-progress-bar" :style="{ width: downloadProgress.total > 0 ? `${Math.min(100, Math.round(downloadProgress.received / downloadProgress.total * 100))}%` : '0%' }"></div>
      </div>
      <div class="dl-toast-meta">
        <span>{{ formatSize(downloadProgress.received) }} / {{ downloadProgress.total > 0 ? formatSize(downloadProgress.total) : '…' }}</span>
        <span>{{ downloadProgress.speed > 0 ? `${formatSize(Math.round(downloadProgress.speed))}/s` : '…' }}</span>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<style scoped>
.fs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  justify-content: center;
  backdrop-filter: blur(3px);
}

.preview-overlay {
  align-items: center;
  padding: 1rem;
  transition: padding 0.2s ease;
}
.preview-overlay:has(.preview-dialog--theater) { padding: 0; }

.preview-dialog {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  height: 85vh;
  max-height: 90vh;
  animation: dialog-pop 0.18s ease;
  overflow: hidden;
  transition: height 0.2s ease, max-height 0.2s ease, border-radius 0.2s ease;
}
.preview-dialog--theater { height: 100vh; max-height: 100vh; max-width: 100vw; border-radius: 0; }

/* Native browser fullscreen (Fullscreen API) */
.preview-dialog:fullscreen {
  width: 100vw;
  height: 100vh;
  max-width: 100vw;
  max-height: 100vh;
  border-radius: 0;
  background: #0d0d0d;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  gap: 1rem;
  flex-shrink: 0;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.preview-title { font-size: 1rem; font-weight: 700; color: #21313f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; transition: color 0.2s ease; }
.preview-header-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
.preview-close-btn { width: 36px; height: 36px; border: 0; border-radius: 50%; background: #f1f5f9; color: #64748b; font-size: 0.9rem; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s, color 0.15s; }
.preview-close-btn:hover { background: #e2e8f0; color: #0f172a; }
.preview-close-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.preview-action-active { background: #dbeafe; color: #2563eb; }
.preview-action-active:hover { background: #bfdbfe; color: #1d4ed8; }

/* In native fullscreen, overlay the header on top of the content instead of
   pushing it down. */
.preview-dialog:fullscreen .preview-header {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 1;
  border-bottom: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
}
.preview-dialog:fullscreen .preview-title { color: #fff; }
.preview-dialog:fullscreen .preview-close-btn { background: rgba(255, 255, 255, 0.12); color: #fff; }
.preview-dialog:fullscreen .preview-close-btn:hover { background: rgba(255, 255, 255, 0.25); color: #fff; }
.preview-dialog:fullscreen .preview-action-active { background: rgba(96, 165, 250, 0.35); color: #fff; }
.preview-dialog:fullscreen .preview-action-active:hover { background: rgba(96, 165, 250, 0.5); color: #fff; }

.preview-body { flex: 1; overflow: auto; display: flex; flex-direction: column; min-height: 0; }
.preview-state { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; padding: 2rem; color: #617182; min-height: 220px; }
.preview-progress-text { font-size: 0.85rem; color: #94a3b8; margin: 0; }

.preview-image-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1rem; background: #0d0d0d; min-height: 300px; }
.preview-image { max-width: 100%; max-height: 72vh; object-fit: contain; border-radius: 6px; }

.preview-audio-wrap { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1.25rem; padding: 3rem 2rem; }
.audio-icon { font-size: 4rem; color: #94a3b8; line-height: 1; }
.audio-name { font-weight: 600; color: #21313f; text-align: center; margin: 0; overflow-wrap: anywhere; }
.preview-audio { width: 100%; max-width: 420px; }

.preview-video-wrap { flex: 1; display: flex; align-items: center; justify-content: center; background: #0d0d0d; min-height: 300px; }
.preview-video { width: 100%; max-width: 100%; max-height: 72vh; }
.preview-dialog--theater .preview-video-wrap,
.preview-dialog:fullscreen .preview-video-wrap { overflow: hidden; }
.preview-dialog--theater .preview-video,
.preview-dialog:fullscreen .preview-video { max-height: 100%; height: 100%; width: 100%; object-fit: contain; }

.preview-pdf-wrap { flex: 1; display: flex; min-height: 60vh; }
.preview-pdf { width: 100%; height: 100%; min-height: 60vh; border: 0; }

.preview-text-wrap { flex: 1; overflow: auto; background: #272822; padding: 1.25rem; }
.preview-text { margin: 0; font-size: 0.82rem; line-height: 1.65; color: #f8f8f2; white-space: pre-wrap; word-break: break-word; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }

@keyframes dialog-pop {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

/* Download toast */
.dl-toast {
  position: fixed;
  bottom: 1.25rem;
  right: 1.25rem;
  width: 280px;
  background: #1e293b;
  border-radius: 14px;
  padding: 0.85rem 1rem;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  z-index: 3000;
}
.dl-toast-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
.dl-toast-icon { color: #60a5fa; font-size: 0.9rem; }
.dl-toast-title { font-size: 0.8rem; font-weight: 700; color: #f1f5f9; flex: 1; }
.dl-toast-cancel { background: transparent; border: 0; color: #94a3b8; font-size: 0.8rem; cursor: pointer; padding: 0; display: flex; }
.dl-toast-cancel:hover { color: #f1f5f9; }
.dl-toast-name { font-size: 0.75rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.5rem; }
.dl-progress-bar-wrap { height: 4px; background: #334155; border-radius: 2px; margin-bottom: 0.35rem; }
.dl-progress-bar { height: 100%; background: #60a5fa; border-radius: 2px; transition: width 0.3s; }
.dl-toast-meta { display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b; }
</style>
