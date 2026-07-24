import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Session } from 'xconn'
import { useAuthStore } from './auth'

// Both live outside the store so they persist across hot reloads / resets
const cache = new Map<string, Session>()
// De-dupes concurrent acquire() calls for the same realm so two callers never
// race separate authStore.shell() attempts against each other.
const pending = new Map<string, Promise<Session | null>>()

export const useSessionCacheStore = defineStore('sessionCache', () => {
  // Individual panels (terminal, files, ...) notice a dead desktop as soon as
  // their next call fails — well before the session's own transport-level
  // onDisconnect fires, which for plain WAMP can lag far behind since the
  // browser's socket to the router stays open. Reactive so DesktopSessionHost
  // can blur immediately instead of waiting on the slower session-level signal.
  const unreachableRealms = ref(new Set<string>())

  function reportUnreachable(realm: string) {
    if (!unreachableRealms.value.has(realm)) {
      unreachableRealms.value = new Set(unreachableRealms.value).add(realm)
    }
    invalidate(realm)
  }

  function clearUnreachable(realm: string) {
    if (unreachableRealms.value.has(realm)) {
      const next = new Set(unreachableRealms.value)
      next.delete(realm)
      unreachableRealms.value = next
    }
  }

  async function acquire(realm: string): Promise<Session | null> {
    const existing = cache.get(realm)
    if (existing?.isConnected()) return existing
    cache.delete(realm)

    const inFlight = pending.get(realm)
    if (inFlight) return inFlight

    const attempt = (async (): Promise<Session | null> => {
      const authStore = useAuthStore()
      const raw = await authStore.shell(realm)
      if (!raw) return null

      const session = raw as Session
      cache.set(realm, session)

      session.onDisconnect(async () => {
        if (cache.get(realm) === session) cache.delete(realm)
      })

      return session
    })()

    pending.set(realm, attempt)
    try {
      return await attempt
    } finally {
      if (pending.get(realm) === attempt) pending.delete(realm)
    }
  }

  function invalidateAll() {
    for (const [realm, session] of [...cache]) {
      cache.delete(realm)
      session.leave().catch(() => {})
    }
  }

  // Discards a realm's cached session even if it's still "connected" at the
  // router level (e.g. deskconnd itself is unreachable) so the next acquire()
  // reconnects from scratch instead of reusing a stale fallback session.
  function invalidate(realm: string) {
    const session = cache.get(realm)
    if (!session) return
    cache.delete(realm)
    session.leave().catch(() => {})
  }

  function isActive(realm: string): boolean {
    return cache.get(realm)?.isConnected() ?? false
  }

  function isAnyActive(): boolean {
    for (const session of cache.values()) {
      if (session.isConnected()) return true
    }
    return false
  }

  return {
    acquire,
    invalidateAll,
    invalidate,
    isActive,
    isAnyActive,
    unreachableRealms,
    reportUnreachable,
    clearUnreachable,
  }
})
