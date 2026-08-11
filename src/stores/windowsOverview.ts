import { ref } from 'vue'
import { defineStore } from 'pinia'

// Size of the tile a window's live content is scaled down to fit — matches
// .windows-overview-preview in AppDock.vue.
export const WINDOW_PREVIEW_WIDTH = 200
export const WINDOW_PREVIEW_HEIGHT = 125

// Per-window-id slot the owning FloatingWindow's live content teleports
// into while AppDock's "show all windows" overview is open.
export const useWindowsOverviewStore = defineStore('windowsOverview', () => {
  const previewTargets = ref<Record<string, HTMLElement>>({})

  function registerPreviewTarget(windowId: string, el: HTMLElement) {
    // Function refs re-fire on every render of the owner (Vue does this
    // unconditionally, even with a stable callback identity) — skip the
    // write when nothing actually changed, or this replaces the object on
    // every render forever.
    if (previewTargets.value[windowId] === el) return
    previewTargets.value = { ...previewTargets.value, [windowId]: el }
  }

  function unregisterPreviewTarget(windowId: string) {
    if (!(windowId in previewTargets.value)) return
    const next = { ...previewTargets.value }
    delete next[windowId]
    previewTargets.value = next
  }

  return { previewTargets, registerPreviewTarget, unregisterPreviewTarget }
})
