export type {}

type SWActivateEvent = { waitUntil(p: Promise<unknown>): void }
type SWFetchEvent = { request: Request; respondWith(r: Promise<Response>): void }
type SWMessageEvent = { data: Record<string, unknown> | null; ports: readonly MessagePort[] }
type SWScope = {
  clients: { claim(): Promise<void> }
  addEventListener(type: 'activate', listener: (event: SWActivateEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: SWFetchEvent) => void): void
  addEventListener(type: 'message', listener: (event: SWMessageEvent) => void): void
}

interface DownloadEntry {
  download: DownloadData | null
  responseReady: Promise<void>
  resolveResponse: () => void
  responseResolved: boolean
}

interface DownloadData {
  stream: ReadableStream<Uint8Array>
  filename: string
  size: number
}

const sw = self as unknown as SWScope

const pending = new Map<string, DownloadEntry>()

function ensurePending(id: string): DownloadEntry {
  let entry = pending.get(id)
  if (entry) return entry

  let resolveResponse!: () => void
  const responseReady = new Promise<void>((resolve) => { resolveResponse = resolve })

  entry = { download: null, responseReady, resolveResponse, responseResolved: false }
  pending.set(id, entry)
  return entry
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim())
})

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith('/_dl/')) return
  const id = url.pathname.slice(5)
  const entry = ensurePending(id)
  event.respondWith((async () => {
    await entry.responseReady
    const download = entry.download
    if (!download) return Response.error()
    pending.delete(id)
    return new Response(download.stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
        ...(download.size > 0 ? { 'Content-Length': String(download.size) } : {}),
      },
    })
  })())
})

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'ping') return
  if (event.data?.type !== 'download') return
  const entry = ensurePending(event.data.id as string)
  const maybePort = event.ports[0]
  if (!maybePort) return
  const port: MessagePort = maybePort

  const queuedChunks: Uint8Array[] = []
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  let streamCancelled = false
  let closeRequested = false
  let pullRequested = false

  function resolveResponseIfNeeded() {
    if (entry.responseResolved) return
    entry.responseResolved = true
    entry.resolveResponse()
  }

  function requestNextChunkIfNeeded() {
    if (streamCancelled || closeRequested || !streamController || pullRequested) return
    if ((streamController.desiredSize ?? 0) <= 0) return
    if (queuedChunks.length > 0) return
    pullRequested = true
    port.postMessage({ type: 'pull' })
  }

  function flushQueuedChunks() {
    if (!streamController || streamCancelled) return
    while (queuedChunks.length > 0 && (streamController.desiredSize ?? 0) > 0) {
      streamController.enqueue(queuedChunks.shift()!)
    }
    if (closeRequested && queuedChunks.length === 0) {
      streamCancelled = true
      closeRequested = false
      streamController.close()
      port.close()
      return
    }
    requestNextChunkIfNeeded()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      port.addEventListener('message', (messageEvent) => {
        const data = messageEvent.data ?? {}
        if (data.type === 'meta') {
          if (typeof data.filename === 'string' && data.filename) {
            entry.download!.filename = data.filename as string
          }
          if (typeof data.size === 'number' && Number.isFinite(data.size) && data.size > 0) {
            entry.download!.size = data.size as number
          }
          resolveResponseIfNeeded()
          return
        }
        if (data.type === 'chunk' && data.chunk instanceof ArrayBuffer) {
          pullRequested = false
          resolveResponseIfNeeded()
          queuedChunks.push(new Uint8Array(data.chunk as ArrayBuffer))
          flushQueuedChunks()
          return
        }
        if (data.type === 'close') {
          closeRequested = true
          resolveResponseIfNeeded()
          flushQueuedChunks()
          return
        }
        if (data.type === 'error') {
          streamCancelled = true
          resolveResponseIfNeeded()
          controller.error(new Error((data.message as string) || 'Download failed'))
          port.close()
        }
      })
      port.start()
      requestNextChunkIfNeeded()
    },
    pull() {
      flushQueuedChunks()
    },
    cancel() {
      streamCancelled = true
      port.close()
    },
  })

  entry.download = { stream, filename: event.data.filename as string, size: 0 }
})
