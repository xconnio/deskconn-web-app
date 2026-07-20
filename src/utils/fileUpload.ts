/**
 * Client side of the `io.xconn.deskconn.deskconnd.file.upload` protocol (see
 * fileupload.go on the backend).
 *
 * Reuses the realm's shared session encryption key (see stores/sessionEncryption.ts)
 * rather than doing its own in-band key exchange: the backend keeps a single key per
 * WAMP session, and every window on that session (Files, Pictures, an Image Viewer
 * save, ...) must share it — a second exchange invalidates whatever any other window
 * already cached and breaks its next encrypted call. Skipping straight to the 'I'
 * (init) frame with the shared key is exactly what EmbeddedDesktopFiles.vue's own
 * upload does once it already holds a key.
 */
import { Progress, type Result, type Session } from 'xconn'
import { encryptPayload } from '@/utils/encryption'
import { useSessionEncryptionStore } from '@/stores/sessionEncryption'

const procedureFileUpload = 'io.xconn.deskconn.deskconnd.file.upload'
const UPLOAD_CHUNK_SIZE = 1024 * 1024

export interface UploadProgress {
  sent: number
  total: number
  speed: number
}

export async function uploadFileToPath(
  session: Session,
  realm: string,
  destDir: string,
  fileName: string,
  file: Blob,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error('cancelled')

  const sessionEncryptionStore = useSessionEncryptionStore()
  const { encryptKey: sendKey } = await sessionEncryptionStore.getOrExchange(session, realm)

  const startTime = Date.now()
  let seq = 0
  let fileOffset = 0
  let ackWaiter: { resolve: (r: Result) => void; reject: (e: Error) => void } | null = null

  const onAbort = () => {
    ackWaiter?.reject(new Error('cancelled'))
    ackWaiter = null
  }
  signal?.addEventListener('abort', onAbort)

  const progressHandler = async (result: Result) => {
    ackWaiter?.resolve(result)
    ackWaiter = null
  }

  function waitForAck(): Promise<Result> {
    if (signal?.aborted) return Promise.reject(new Error('cancelled'))
    return new Promise((resolve, reject) => { ackWaiter = { resolve, reject } })
  }

  function enc(obj: object): Uint8Array {
    return encryptPayload(new TextEncoder().encode(JSON.stringify(obj)), sendKey)
  }

  async function* frames(): AsyncGenerator<Progress> {
    yield new Progress(
      ['I', seq++, enc({ remote_path: destDir, source_is_dir: false, target_is_dir_hint: true })],
      {},
      { progress: true },
    )
    await waitForAck()

    yield new Progress(
      ['H', seq++, enc({ name: fileName, rel_path: fileName, size: file.size, mode: 0, is_dir: false })],
      {},
      { progress: true },
    )

    while (fileOffset < file.size) {
      await waitForAck()
      const chunkBytes = new Uint8Array(await file.slice(fileOffset, fileOffset + UPLOAD_CHUNK_SIZE).arrayBuffer())
      fileOffset += chunkBytes.length
      const elapsed = (Date.now() - startTime) / 1000
      onProgress?.({ sent: fileOffset, total: file.size, speed: elapsed > 0 ? fileOffset / elapsed : 0 })
      yield new Progress(['D', seq++, encryptPayload(chunkBytes, sendKey)], {}, { progress: true })
    }

    await waitForAck()
    yield new Progress(['E', seq], {}, {})
  }

  const gen = frames()
  const progressFunc = async () => (await gen.next()).value as Progress

  try {
    await session.callProgressiveProgress(procedureFileUpload, progressFunc, progressHandler)
  } catch (err) {
    if (signal?.aborted) {
      // Aborting mid-stream never tells the backend the call ended, so it keeps its
      // per-session upload state around — a later upload would get stuck waiting on
      // a sequence number that will never arrive. Any non-'E' call discards it.
      try { await session.call(procedureFileUpload, ['C']) } catch { /* best-effort cleanup */ }
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
