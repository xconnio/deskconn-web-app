import { defineStore } from 'pinia'
import type { Session } from 'xconn'
import { createX25519KeyPair, deriveSessionKeys, type EncryptionKeys } from '@/utils/encryption'

const procedureKeyExchange = 'io.xconn.deskconn.deskconnd.key.exchange'

// One key per realm session (backend enforces this too, see d.keys) — shared
// so no window redoes the handshake behind another's back and invalidates it.
const cache = new Map<string, EncryptionKeys>()
const pending = new Map<string, Promise<EncryptionKeys>>()
// Re-exchange on reconnect, since the backend drops its half on session leave.
const hookedSessions = new WeakSet<Session>()

async function exchange(session: Session): Promise<EncryptionKeys> {
  const { publicKey, privateKey } = createX25519KeyPair()
  const result = await session.call(procedureKeyExchange, [publicKey])
  const serverPublicKey = result.args?.[0] as Uint8Array
  if (!serverPublicKey?.length) throw new Error('Invalid key exchange response')
  return deriveSessionKeys(privateKey, serverPublicKey)
}

export const useSessionEncryptionStore = defineStore('sessionEncryption', () => {
  async function getOrExchange(session: Session, realm: string): Promise<EncryptionKeys> {
    if (!hookedSessions.has(session)) {
      hookedSessions.add(session)
      session.onDisconnect(async () => { cache.delete(realm); pending.delete(realm) })
    }

    const existing = cache.get(realm)
    if (existing) return existing

    const inFlight = pending.get(realm)
    if (inFlight) return inFlight

    const attempt = exchange(session).then((keys) => {
      cache.set(realm, keys)
      return keys
    })

    pending.set(realm, attempt)
    try {
      return await attempt
    } finally {
      if (pending.get(realm) === attempt) pending.delete(realm)
    }
  }

  function invalidate(realm: string) {
    cache.delete(realm)
  }

  // deskconnd keys by caller session, so a P2P upgrade needs its own
  // exchange. Written into the existing object in place so components that
  // already hold it pick up the new keys without re-fetching.
  function adopt(realm: string, keys: EncryptionKeys) {
    const existing = cache.get(realm)
    if (existing) Object.assign(existing, keys)
    else cache.set(realm, keys)
  }

  function isExchanging(realm: string): boolean {
    return pending.has(realm)
  }

  return { getOrExchange, invalidate, exchange, adopt, isExchanging }
})
