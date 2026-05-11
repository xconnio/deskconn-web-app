import { defineStore } from 'pinia'
import type { Session } from 'xconn'
import { useAuthStore } from './auth'

// Lives outside the store so it persists across hot reloads / resets
const cache = new Map<string, Session>()

export const useSessionCacheStore = defineStore('sessionCache', () => {
  async function acquire(realm: string): Promise<Session | null> {
    const existing = cache.get(realm)
    if (existing?.isConnected()) return existing
    cache.delete(realm)

    const authStore = useAuthStore()
    const raw = await authStore.shell(realm)
    if (!raw) return null

    const session = raw as Session
    cache.set(realm, session)

    session.onDisconnect(async () => {
      if (cache.get(realm) === session) cache.delete(realm)
    })

    return session
  }

  function invalidateAll() {
    for (const [realm, session] of [...cache]) {
      cache.delete(realm)
      session.leave().catch(() => {})
    }
  }

  return { acquire, invalidateAll }
})
