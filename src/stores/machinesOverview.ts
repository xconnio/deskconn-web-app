import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useMachinesOverviewStore = defineStore('machinesOverview', () => {
  // Per-realm slot a live DesktopSessionHost teleports its desktop into —
  // only populated while the Machines page (MachinesOverview.vue) is mounted.
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

  return { previewTargets, registerPreviewTarget, unregisterPreviewTarget }
})
