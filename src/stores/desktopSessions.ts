import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWindowManager } from '@/composables/useWindowManager'

type WindowManager = ReturnType<typeof useWindowManager>

// Lives outside the store so it persists across hot reloads / resets, same as
// sessionCache.ts's `cache` Map.
const managers = new Map<string, WindowManager>()

export const useDesktopSessionsStore = defineStore('desktopSessions', () => {
  // Plain Map mutations aren't tracked by Vue's reactivity; this is what lets
  // consumers react to a brand-new realm being registered.
  const knownRealms = ref<string[]>([])

  function getOrCreate(realm: string): WindowManager {
    let mgr = managers.get(realm)
    if (!mgr) {
      mgr = useWindowManager()
      managers.set(realm, mgr)
      knownRealms.value = [...knownRealms.value, realm]
    }
    return mgr
  }

  function hasOpenWindows(realm: string): boolean {
    return (managers.get(realm)?.windows.value.length ?? 0) > 0
  }

  function anyOpenWindowsAnywhere(): boolean {
    for (const mgr of managers.values()) {
      if (mgr.windows.value.length > 0) return true
    }
    return false
  }

  return { knownRealms, getOrCreate, hasOpenWindows, anyOpenWindowsAnywhere }
})
