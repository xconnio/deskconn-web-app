// Range-based file streaming over a raw (non-WAMP) WebRTC data channel. One
// channel is opened per range request: the channel's first message is the
// JSON-encoded request, the response is a JSON header frame followed by raw
// binary chunks, and the server closes the channel once it has sent the full
// range. See deskconn's filestreamchannel.go for the server side of this
// protocol.
import { getWebRTCSession } from './rtcRegistry'
import type { WampSession } from './wamp'

const CHANNEL_LABEL = 'file-stream'

export class NoDirectConnectionError extends Error {
  constructor() {
    super('No direct WebRTC connection to this device')
    this.name = 'NoDirectConnectionError'
  }
}

interface RangeHeader {
  size: number
  offset: number
  length: number
}

export interface RangeResult {
  size: number
  offset: number
  length: number
  stream: ReadableStream<Uint8Array>
}

export function canStreamRanges(session: WampSession | null | undefined): boolean {
  return getWebRTCSession(session) !== null
}

export async function requestRange(
  session: WampSession,
  path: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<RangeResult> {
  const webrtc = getWebRTCSession(session)
  if (!webrtc) throw new NoDirectConnectionError()
  if (signal?.aborted) throw new Error('cancelled')

  const channel = await webrtc.openDataChannel(CHANNEL_LABEL)

  let headerResolve!: (header: RangeHeader) => void
  let headerReject!: (err: Error) => void
  const headerPromise = new Promise<RangeHeader>((resolve, reject) => {
    headerResolve = resolve
    headerReject = reject
  })

  let receivedHeader = false
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  let settled = false

  const onAbort = () => {
    try { channel.close() } catch { /* ignore */ }
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  function finish() {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', onAbort)
    if (streamController) {
      try { streamController.close() } catch { /* already closed/errored */ }
    }
    if (!receivedHeader) {
      headerReject(new Error('stream closed before header was received'))
    }
  }

  channel.onmessage = (event: MessageEvent) => {
    if (!receivedHeader) {
      if (typeof event.data !== 'string') {
        headerReject(new Error('expected a header frame first'))
        channel.close()
        return
      }
      let header: RangeHeader
      try {
        header = JSON.parse(event.data) as RangeHeader
      } catch {
        headerReject(new Error('invalid header frame'))
        channel.close()
        return
      }
      receivedHeader = true
      headerResolve(header)
      return
    }

    if (!(event.data instanceof ArrayBuffer)) return
    streamController?.enqueue(new Uint8Array(event.data))
  }

  channel.onclose = finish
  channel.onerror = finish

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
    cancel() {
      try { channel.close() } catch { /* ignore */ }
    },
  })

  channel.send(JSON.stringify({ path, offset, length }))

  const header = await headerPromise
  return { size: header.size, offset: header.offset, length: header.length, stream }
}
