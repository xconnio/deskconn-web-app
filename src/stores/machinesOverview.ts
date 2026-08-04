import { ref } from 'vue'
import { defineStore } from 'pinia'

// Size of the card slot the live desktop preview is scaled down to fit —
// matches .machines-card-preview in MachinesOverview.vue.
export const PREVIEW_WIDTH = 240
export const PREVIEW_HEIGHT = 150

export const useMachinesOverviewStore = defineStore('machinesOverview', () => {
  const isOpen = ref(false)

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  // Per-realm slot a live DesktopSessionHost teleports its desktop into.
  const previewTargets = ref<Record<string, HTMLElement>>({})

  function registerPreviewTarget(realm: string, el: HTMLElement) {
    // Function refs re-fire on every render of the owner (Vue does this
    // unconditionally, even with a stable callback identity) — skip the
    // write when nothing actually changed, or this replaces the object on
    // every render forever.
    if (previewTargets.value[realm] === el) return
    previewTargets.value = { ...previewTargets.value, [realm]: el }
  }

  function unregisterPreviewTarget(realm: string) {
    if (!(realm in previewTargets.value)) return
    const next = { ...previewTargets.value }
    delete next[realm]
    previewTargets.value = next
  }

  return { isOpen, open, close, toggle, previewTargets, registerPreviewTarget, unregisterPreviewTarget }
})
