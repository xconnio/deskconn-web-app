<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import { useWindowsOverviewStore } from '@/stores/windowsOverview'
import OverviewGrid from '@/components/OverviewGrid.vue'

const route = useRoute()
const router = useRouter()
const desktopSessionsStore = useDesktopSessionsStore()
const windowsOverviewStore = useWindowsOverviewStore()

const realm = computed(() => String(route.params.realm || ''))
const manager = computed(() => desktopSessionsStore.getOrCreate(realm.value))

interface WindowEntry {
  id: string
  title: string
  icon: string
  iconColor: string
  iconBg: string
  minimized: boolean
}

const entries = computed<WindowEntry[]>(() =>
  manager.value.windows.value.map((w) => ({
    id: w.id,
    title: w.title,
    icon: w.icon,
    iconColor: w.iconColor,
    iconBg: w.iconBg,
    minimized: w.minimized,
  })),
)

function goBack() {
  router.push({ name: 'desktop-launcher', params: { realm: realm.value } })
}

// Switch to it, never toggle-minimize it just because it was already focused
// — unlike a dock icon click, selecting a card here always means "show me this one".
function onSelect(entry: WindowEntry) {
  const win = manager.value.windows.value.find((w) => w.id === entry.id)
  if (win) {
    if (win.minimized) manager.value.restoreWindow(entry.id)
    else if (manager.value.focusedId.value !== entry.id) manager.value.focusWindow(entry.id)
  }
  goBack()
}

// Registers this card's slot for the owning DesktopSessionHost to teleport
// that window's live content into — same pattern as MachinesOverview's
// per-realm preview, keyed by window id instead of realm.
function setPreviewTarget(windowId: string, el: Element | null) {
  if (el) windowsOverviewStore.registerPreviewTarget(windowId, el as HTMLElement)
  else windowsOverviewStore.unregisterPreviewTarget(windowId)
}
</script>

<template>
  <OverviewGrid
    title="Open Windows"
    :entries="entries"
    :active-id="manager.focusedId.value"
    show-back
    empty-message="No apps open"
    @select="onSelect"
    @back="goBack"
  >
    <template #preview="{ entry }">
      <div class="preview-slot" :ref="(el) => setPreviewTarget(entry.id, el as Element | null)"></div>
    </template>

    <template #badge="{ entry }">
      <div class="icon-badge" :style="{ color: entry.iconColor, background: entry.iconBg }">
        <i class="bi" :class="entry.icon"></i>
      </div>
    </template>

    <template #label="{ entry }">
      <div class="overview-label">{{ entry.title }}</div>
      <span v-if="entry.minimized" class="overview-minimized">Minimized</span>
    </template>
  </OverviewGrid>
</template>

<style scoped>
.preview-slot {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.icon-badge {
  position: absolute;
  left: 8px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}
</style>
