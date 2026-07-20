<script setup lang="ts">
/**
 * File preview, rendered inside its own FloatingWindow (see DesktopSessionHost.vue).
 * Accepts an established session and a file entry. Images/pdf/text use the
 * WAMP-based full-buffer download (per-file key exchange, H/D framing).
 * Audio/video play natively via a same-origin URL backed by a Service Worker
 * Range-request proxy (see sw-download.ts), which forwards range reads over a
 * raw WebRTC data channel (see services/fileStream.ts) — this requires a
 * direct P2P connection to the device.
 */
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import { type Session } from 'xconn'
import { floatingWindowActionsKey } from '@/composables/floatingWindowToolbar'
import { createX25519KeyPair, deriveSessionKeys, decryptPayload } from '@/utils/encryption'
import { canStreamRanges, requestRange } from '@/services/fileStream'
import {
  type FilePreviewType,
  formatSize,
  getFilePreviewType,
  getMimeType,
  isFirefoxBrowser,
} from '@/utils/fileTypes'

const procedureFileDownload = 'io.xconn.deskconn.deskconnd.file.download'

type PreviewEntry = { path: string; name: string; size: number }

const props = defineProps<{
  session: Session
  entry: PreviewEntry
  entries?: PreviewEntry[]
  focused?: boolean
}>()

const emit = defineEmits<{ 'update-title': [title: string] }>()

// Absent when there's no FloatingWindow ancestor — the download button then
// renders inline instead of teleporting into the window's titlebar.
const actionsHostRef = inject(floatingWindowActionsKey)
const actionsTarget = computed(() => actionsHostRef?.value ?? null)

// The file actually being shown — starts at props.entry but moves independently
// as the user steps through sibling images with the arrows/keyboard, without
// tearing down and reopening the window.
const currentEntry = ref<PreviewEntry>(props.entry)

// Left/right navigation only cycles through images (see openPreview callers,
// which pass every sibling in the current folder/view, not just images).
const imageEntries = computed(() => (props.entries ?? []).filter((e) => getFilePreviewType(e.name) === 'image'))
const currentImageIndex = computed(() => imageEntries.value.findIndex((e) => e.path === currentEntry.value.path))
const canGoPrev = computed(() => previewType.value === 'image' && currentImageIndex.value > 0)
const canGoNext = computed(() => previewType.value === 'image' && currentImageIndex.value >= 0 && currentImageIndex.value < imageEntries.value.length - 1)

function goToEntry(target: PreviewEntry) {
  currentEntry.value = target
  emit('update-title', target.name)
  openFile()
}

function goPrev() {
  if (!canGoPrev.value) return
  const target = imageEntries.value[currentImageIndex.value - 1]
  if (target) goToEntry(target)
}

function goNext() {
  if (!canGoNext.value) return
  const target = imageEntries.value[currentImageIndex.value + 1]
  if (target) goToEntry(target)
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.focused) return
  if (e.key === 'ArrowLeft' && canGoPrev.value) { e.preventDefault(); goPrev() }
  else if (e.key === 'ArrowRight' && canGoNext.value) { e.preventDefault(); goNext() }
}

const previewType          = ref<FilePreviewType>('none')
const previewBlobUrl       = ref('')
const previewTextContent   = ref('')
const previewLoading       = ref(false)
const previewError         = ref('')
const previewExpectedBytes = ref(0)
const previewReceivedBytes = ref(0)
const mediaRetryUsed       = ref(false)

type DownloadProgressState = { name: string; received: number; total: number; speed: number; cancel: () => void }
const downloadProgress = ref<DownloadProgressState | null>(null)

let downloadServiceWorker: ServiceWorker | null = null
let downloadServiceWorkerReadyPromise: Promise<ServiceWorker | null> | null = null
let mounted = true

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

// Bridges range-request messages coming from the stream service worker (see
// sw-download.ts) to the raw WebRTC data channel range protocol (fileStream.ts).
// Multiple range requests (e.g. a browser probing both the start and end of an
// MP4 for its moov box) can be in flight concurrently, each tagged with its own
// reqID and served by its own data channel.
function startStreamBridge(port: MessagePort, session: Session, path: string): () => void {
  const controllers = new Map<number, AbortController>()

  async function handleRangeRequest(reqID: number, offset: number, length: number) {
    const controller = new AbortController()
    controllers.set(reqID, controller)
    try {
      const { stream } = await requestRange(session, path, offset, length, controller.signal)
      const reader = stream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const buf = value.slice().buffer
        port.postMessage({ type: 'chunk', reqID, chunk: buf }, [buf])
      }
      port.postMessage({ type: 'range-done', reqID })
    } catch (err) {
      if (!controller.signal.aborted) {
        port.postMessage({ type: 'error', reqID, message: err instanceof Error ? err.message : 'Stream failed' })
      }
    } finally {
      controllers.delete(reqID)
    }
  }

  port.onmessage = (event: MessageEvent) => {
    const data = event.data ?? {}
    if (data.type === 'range-request') { void handleRangeRequest(data.reqID, data.offset, data.length); return }
    if (data.type === 'cancel') controllers.get(data.reqID)?.abort()
  }
  port.start()

  return () => {
    for (const controller of controllers.values()) controller.abort()
    port.close()
  }
}

let activeStreamCleanup: (() => void) | null = null

function stopActiveStream() {
  activeStreamCleanup?.()
  activeStreamCleanup = null
}

// Plays audio/video natively via the stream service worker acting as a local
// Range-request proxy backed by the WebRTC data channel: the <video>/<audio>
// element gets a same-origin URL and the browser's own media engine handles
// buffering and seeking exactly like it would for a regular HTTP video URL.
// Returns false if there's no direct WebRTC connection to stream over.
async function openStreamedMedia(pt: FilePreviewType): Promise<boolean> {
  if (!canStreamRanges(props.session)) return false

  const sw = downloadServiceWorker ?? await ensureDownloadServiceWorker()
  if (!sw) return false

  stopActiveStream()

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const mc = new MessageChannel()
  const stopBridge = startStreamBridge(mc.port1, props.session, currentEntry.value.path)
  activeStreamCleanup = () => { stopBridge(); sw.postMessage({ type: 'stream-close', id }) }

  sw.postMessage({ type: 'stream-init', id, size: currentEntry.value.size, mimeType: getMimeType(currentEntry.value.name) }, [mc.port2])

  if (previewBlobUrl.value) { URL.revokeObjectURL(previewBlobUrl.value); previewBlobUrl.value = '' }
  previewType.value = pt
  previewBlobUrl.value = `/_stream/${id}/${encodeURIComponent(currentEntry.value.name)}`
  previewLoading.value = false
  previewError.value = ''
  return true
}

async function openFile(isRetry = false) {
  if (!isRetry) mediaRetryUsed.value = false
  const pt = getFilePreviewType(currentEntry.value.name)
  const MAX_IMG_PDF = 100 * 1024 * 1024

  if (pt === 'none' || (pt === 'text' && currentEntry.value.size > 5 * 1024 * 1024)) {
    await downloadFileToClient(); return
  }
  if ((pt === 'image' || pt === 'pdf') && currentEntry.value.size > MAX_IMG_PDF) {
    await downloadFileToClient(); return
  }
  if ((pt === 'audio' || pt === 'video') && !isRetry) {
    const streamed = await openStreamedMedia(pt)
    if (streamed) return
    if (previewBlobUrl.value) { URL.revokeObjectURL(previewBlobUrl.value); previewBlobUrl.value = '' }
    previewType.value = pt
    previewLoading.value = false
    previewError.value = 'Live preview requires a direct connection to this device. Use the Download button above.'
    return
  }

  // Full-buffer fallback: images/pdf/text, and audio/video retried once after a
  // playback error (see handleMediaError).
  stopActiveStream()
  if (previewBlobUrl.value) { URL.revokeObjectURL(previewBlobUrl.value); previewBlobUrl.value = '' }
  previewType.value = pt
  previewLoading.value = true
  previewExpectedBytes.value = currentEntry.value.size
  previewReceivedBytes.value = 0
  previewError.value = ''

  try {
    const data = await fetchFileData(currentEntry.value.path)
    if (!mounted) return
    if (pt === 'text') {
      previewTextContent.value = new TextDecoder('utf-8', { fatal: false }).decode(data)
    } else {
      const blob = new Blob([data.slice()], { type: getMimeType(currentEntry.value.name) })
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
    a.download = currentEntry.value.name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  } else if (previewTextContent.value) {
    const blob = new Blob([previewTextContent.value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = currentEntry.value.name
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
    const handle = await (window as any).showSaveFilePicker({ suggestedName: currentEntry.value.name })
    writable = await handle.createWritable()
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return
    return
  }

  const startTime = Date.now()
  let received = 0
  downloadProgress.value = { name: currentEntry.value.name, received: 0, total: currentEntry.value.size, speed: 0, cancel: () => controller.abort() }
  armStall()

  try {
    await streamFileData(currentEntry.value.path, async (chunk, expectedTotal) => {
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
  sw.postMessage({ type: 'download', id, filename: currentEntry.value.name }, [mc.port2])

  const a = document.createElement('a')
  a.href = `/_dl/${id}`; a.download = currentEntry.value.name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)

  try {
    await streamFileData(currentEntry.value.path, async (chunk, expectedTotal) => {
      armStall()
      if (!sentMeta) {
        mc.port1.postMessage({ type: 'meta', filename: currentEntry.value.name, size: expectedTotal > 0 ? expectedTotal : 0 })
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

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  openFile()
})

onUnmounted(() => {
  mounted = false
  document.removeEventListener('keydown', handleKeydown)
  if (previewBlobUrl.value) URL.revokeObjectURL(previewBlobUrl.value)
  stopActiveStream()
})
</script>

<template>
  <div class="preview-window">
    <Teleport :to="actionsTarget ?? 'body'" :disabled="!actionsTarget">
      <button class="preview-download-btn" @click="downloadFromPreview" :disabled="previewLoading" title="Download">
        <i class="bi bi-download"></i>
      </button>
    </Teleport>

    <div class="preview-body">
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
        <button v-if="canGoPrev" class="preview-nav-btn preview-nav-btn--prev" @click="goPrev" title="Previous image">
          <i class="bi bi-chevron-left"></i>
        </button>
        <img :src="previewBlobUrl" :alt="currentEntry.name" class="preview-image" />
        <button v-if="canGoNext" class="preview-nav-btn preview-nav-btn--next" @click="goNext" title="Next image">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>

      <div v-else-if="previewType === 'audio' && previewBlobUrl" class="preview-audio-wrap">
        <div class="audio-icon"><i class="bi bi-music-note-beamed"></i></div>
        <p class="audio-name">{{ currentEntry.name }}</p>
        <audio :src="previewBlobUrl" controls autoplay class="preview-audio" @error="handleMediaError" />
      </div>

      <div v-else-if="previewType === 'video' && previewBlobUrl" class="preview-video-wrap">
        <video :src="previewBlobUrl" controls autoplay class="preview-video" @error="handleMediaError" />
      </div>

      <div v-else-if="previewType === 'pdf' && previewBlobUrl" class="preview-pdf-wrap">
        <iframe :src="previewBlobUrl" class="preview-pdf" />
      </div>

      <div v-else-if="previewType === 'text'" class="preview-text-wrap">
        <pre class="preview-text">{{ previewTextContent }}</pre>
      </div>
    </div>
  </div>

  <!-- Download progress toast -->
  <Teleport to="body">
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
.preview-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

/* Teleported into the FloatingWindow's titlebar, beside minimize/maximize/close
   (see floatingWindowActionsKey) — sized to match FloatingWindow's own .fwin-btn. */
.preview-download-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid #d9dee4;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  font-size: 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.preview-download-btn:hover { background: #e2e8f0; color: #111827; }
.preview-download-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.preview-body { flex: 1; overflow: auto; display: flex; flex-direction: column; min-height: 0; }
.preview-state { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; padding: 2rem; color: #617182; min-height: 220px; }
.preview-progress-text { font-size: 0.85rem; color: #94a3b8; margin: 0; }

.preview-image-wrap { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 1rem; background: #0d0d0d; min-height: 300px; }
.preview-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }

.preview-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.45);
  color: #fff;
  font-size: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
  z-index: 1;
}
.preview-nav-btn:hover { background: rgba(15, 23, 42, 0.7); }
.preview-nav-btn--prev { left: 0.75rem; }
.preview-nav-btn--next { right: 0.75rem; }

.preview-audio-wrap { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1.25rem; padding: 3rem 2rem; }
.audio-icon { font-size: 4rem; color: #94a3b8; line-height: 1; }
.audio-name { font-weight: 600; color: #21313f; text-align: center; margin: 0; overflow-wrap: anywhere; }
.preview-audio { width: 100%; max-width: 420px; }

.preview-video-wrap { flex: 1; display: flex; align-items: center; justify-content: center; background: #0d0d0d; min-height: 300px; overflow: hidden; }
.preview-video { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; }

.preview-pdf-wrap { flex: 1; display: flex; min-height: 0; }
.preview-pdf { width: 100%; height: 100%; border: 0; }

.preview-text-wrap { flex: 1; overflow: auto; background: #272822; padding: 1.25rem; }
.preview-text { margin: 0; font-size: 0.82rem; line-height: 1.65; color: #f8f8f2; white-space: pre-wrap; word-break: break-word; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }

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
