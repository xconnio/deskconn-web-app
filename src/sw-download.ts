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

  if (url.pathname.startsWith('/_dl/')) {
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
    return
  }

  if (url.pathname.startsWith('/_stream/')) {
    const id = url.pathname.slice('/_stream/'.length).split('/')[0] ?? ''
    event.respondWith(handleStreamFetch(id, event.request))
  }
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

// --- Range-based streaming (video/audio preview) ---
//
// Unlike downloads, a stream serves many range requests over its lifetime (one
// per <video>/<audio> byte-range fetch, including seeks). The page registers a
// stream with `stream-init` and keeps the port open; each fetch to
// /_stream/<id>/... is tagged with a request id so multiple concurrent range
// fetches (e.g. a browser probing both the start and end of an MP4 for its
// moov box) can be multiplexed over the single port without mixing up chunks.

interface StreamEntry {
  size: number
  mimeType: string
  port: MessagePort | null
  responseReady: Promise<void>
  resolveResponse: () => void
  responseResolved: boolean
}

const streams = new Map<string, StreamEntry>()
let nextRequestID = 1

function ensureStream(id: string): StreamEntry {
  let entry = streams.get(id)
  if (entry) return entry

  let resolveResponse!: () => void
  const responseReady = new Promise<void>((resolve) => { resolveResponse = resolve })

  entry = { size: 0, mimeType: 'application/octet-stream', port: null, responseReady, resolveResponse, responseResolved: false }
  streams.set(id, entry)
  return entry
}

function parseRange(rangeHeader: string | null, size: number): { start: number; length: number; partial: boolean } | null {
  if (!rangeHeader) return { start: 0, length: size, partial: false }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const startStr = match[1] ?? ''
  const endStr = match[2] ?? ''
  if (startStr === '' && endStr === '') return null

  let start: number
  let end: number
  if (startStr === '') {
    const suffixLength = parseInt(endStr, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = parseInt(startStr, 10)
    end = endStr === '' ? size - 1 : parseInt(endStr, 10)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) return null
  if (size > 0 && start >= size) return null
  end = Math.min(end, size - 1)
  return { start, length: end - start + 1, partial: true }
}

async function handleStreamFetch(id: string, request: Request): Promise<Response> {
  const entry = ensureStream(id)
  await entry.responseReady
  const port = entry.port
  if (!port) return Response.error()

  const range = parseRange(request.headers.get('Range'), entry.size)
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${entry.size}`, 'Accept-Ranges': 'bytes' },
    })
  }

  const reqID = nextRequestID++
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  let settled = false

  const onMessage = (messageEvent: MessageEvent) => {
    const data = messageEvent.data ?? {}
    if (data.reqID !== reqID) return
    if (data.type === 'chunk' && data.chunk instanceof ArrayBuffer) {
      streamController?.enqueue(new Uint8Array(data.chunk as ArrayBuffer))
      return
    }
    if (data.type === 'range-done') {
      settled = true
      port.removeEventListener('message', onMessage)
      try { streamController?.close() } catch { /* already closed */ }
      return
    }
    if (data.type === 'error') {
      settled = true
      port.removeEventListener('message', onMessage)
      streamController?.error(new Error((data.message as string) || 'Stream failed'))
    }
  }
  port.addEventListener('message', onMessage)

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    cancel() {
      if (settled) return
      settled = true
      port.removeEventListener('message', onMessage)
      port.postMessage({ type: 'cancel', reqID })
    },
  })

  port.postMessage({ type: 'range-request', reqID, offset: range.start, length: range.length })

  const headers: Record<string, string> = {
    'Content-Type': entry.mimeType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range.length),
  }
  if (range.partial) {
    headers['Content-Range'] = `bytes ${range.start}-${range.start + range.length - 1}/${entry.size}`
  }

  return new Response(body, { status: range.partial ? 206 : 200, headers })
}

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'stream-init') {
    const id = event.data.id as string
    const entry = ensureStream(id)
    const port = event.ports[0]
    if (!port) return
    entry.port = port
    entry.size = typeof event.data.size === 'number' ? (event.data.size as number) : 0
    entry.mimeType = typeof event.data.mimeType === 'string' ? (event.data.mimeType as string) : entry.mimeType
    port.start()
    if (!entry.responseResolved) {
      entry.responseResolved = true
      entry.resolveResponse()
    }
    return
  }
  if (event.data?.type === 'stream-close') {
    const id = event.data.id as string
    const entry = streams.get(id)
    entry?.port?.close()
    streams.delete(id)
  }
})
