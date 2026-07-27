/**
 * Client side of the `io.xconn.deskconn.deskconnd.file.download` protocol —
 * shared by FilePreviewModal.vue (its own Download button / oversized-file
 * fallback) and DesktopSessionHost.vue (files that have no previewer at all,
 * which skip opening a preview window and go straight to a download).
 */
import { type Ref } from 'vue'
import { type Session } from 'xconn'
import { createX25519KeyPair, deriveSessionKeys, decryptPayload } from '@/utils/encryption'
import { downloadUrl } from '@/utils/download'
import { isFirefoxBrowser } from '@/utils/fileTypes'

const procedureFileDownload = 'io.xconn.deskconn.deskconnd.file.download'

export type DownloadEntry = { path: string; name: string; size: number }
export type DownloadProgressState = { name: string; received: number; total: number; speed: number; cancel: () => void }

type CallResult = Awaited<ReturnType<Session['call']>>

export async function streamFileData(
  session: Session,
  remotePath: string,
  onChunk: (chunk: Uint8Array, expectedTotal: number) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const LATE_PROGRESS_WAIT_MS = 250
  const MAX_LATE_PROGRESS_WAIT_MS = 5_000

  const { publicKey, privateKey } = createX25519KeyPair()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progressResult: any = await session.callProgress(procedureFileDownload, [remotePath, false, publicKey])

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

let downloadServiceWorker: ServiceWorker | null = null
let downloadServiceWorkerReadyPromise: Promise<ServiceWorker | null> | null = null

export async function ensureDownloadServiceWorker(): Promise<ServiceWorker | null> {
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

async function downloadFileWithSavePicker(
  session: Session,
  entry: DownloadEntry,
  progress: Ref<DownloadProgressState | null>,
  controller: AbortController,
  armStall: () => void,
  clearStall: () => void,
  onError: (err: unknown) => void,
) {
  let writable: FileSystemWritableFileStream | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showSaveFilePicker({ suggestedName: entry.name })
    writable = await handle.createWritable()
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return
    return
  }

  const startTime = Date.now()
  let received = 0
  progress.value = { name: entry.name, received: 0, total: entry.size, speed: 0, cancel: () => controller.abort() }
  armStall()

  try {
    await streamFileData(session, entry.path, async (chunk, expectedTotal) => {
      armStall()
      await writable!.write(chunk.slice())
      received += chunk.length
      if (!progress.value) return
      progress.value.received = received
      if (expectedTotal > 0) progress.value.total = expectedTotal
      const elapsed = (Date.now() - startTime) / 1000
      progress.value.speed = elapsed > 0 ? received / elapsed : 0
    }, controller.signal)
    await writable!.close()
  } catch (err) {
    try { await writable?.abort() } catch { /* ignore */ }
    onError(err)
  } finally {
    clearStall(); progress.value = null
  }
}

async function downloadFileWithBrowserDownload(
  session: Session,
  entry: DownloadEntry,
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
  sw.postMessage({ type: 'download', id, filename: entry.name }, [mc.port2])

  downloadUrl(`/_dl/${id}`, entry.name)

  try {
    await streamFileData(session, entry.path, async (chunk, expectedTotal) => {
      armStall()
      if (!sentMeta) {
        mc.port1.postMessage({ type: 'meta', filename: entry.name, size: expectedTotal > 0 ? expectedTotal : 0 })
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

/** Downloads `entry` to the client, reporting progress into `progress` when the
 * File System Access API is available (Firefox and the plain-browser-download
 * fallback have no progress signal of their own). */
export async function downloadFile(
  session: Session,
  entry: DownloadEntry,
  progress: Ref<DownloadProgressState | null>,
): Promise<void> {
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
    await downloadFileWithSavePicker(session, entry, progress, controller, armStall, clearStall, onError); return
  }
  try {
    await downloadFileWithBrowserDownload(session, entry, controller.signal, armStall, clearStall)
  } catch (err) {
    clearStall(); onError(err)
  }
}
