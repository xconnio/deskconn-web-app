/**
 * Client side of `io.xconn.deskconn.deskconnd.file.cat` (see filecat.go) — simpler
 * than file.download: raw encrypted chunks stream straight through, no framing.
 */
import { type Session } from 'xconn'
import { createX25519KeyPair, deriveSessionKeys, decryptPayload } from '@/utils/encryption'

const procedureFileCat = 'io.xconn.deskconn.deskconnd.file.cat'

type CallResult = { args?: unknown[] }

export async function streamFileCat(
  session: Session,
  remotePath: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error('cancelled')

  const { publicKey, privateKey } = createX25519KeyPair()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progressResult: any = await session.callProgress(procedureFileCat, [remotePath, publicKey])

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

  const onAbort = () => notify()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) throw new Error('cancelled')
      if (queue.length === 0) {
        if (streamDone) break
        await new Promise<void>((resolve) => { wakeUp = resolve })
        continue
      }
      const result = queue.shift()!
      const args = (result.args ?? []) as unknown[]
      if (firstMessage) {
        firstMessage = false
        const raw = args[0] as Uint8Array
        if (!raw || raw.length < 36) throw new Error('Invalid key exchange message from server')
        receiveKey = (await deriveSessionKeys(privateKey, raw.slice(4))).decryptKey
        continue
      }
      if (!receiveKey) continue
      const encrypted = args[0] as Uint8Array | undefined
      if (!encrypted) continue
      const chunk = decryptPayload(encrypted, receiveKey)
      await onChunk(chunk)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  if (streamError) throw streamError instanceof Error ? streamError : new Error('Stream failed')
}
