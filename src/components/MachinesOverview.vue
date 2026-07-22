<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useMachinesStore } from '@/stores/machines'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import { useMachinesOverviewStore } from '@/stores/machinesOverview'
import { openLauncher } from '@/router/navigation'
import { loadCachedWallpaper } from '@/composables/useWallpaperCache'

const machinesStore = useMachinesStore()
const desktopSessionsStore = useDesktopSessionsStore()
const machinesOverviewStore = useMachinesOverviewStore()

// A realm can have a live DesktopSessionHost mounted (e.g. it's the one
// currently open) before machinesStore has finished loading the machine
// list, or after it's since dropped out of that list — every live realm
// still gets a card, falling back to the raw realm as the name.
const displayDesktops = computed(() => {
  const known = machinesStore.desktops
  const extra = desktopSessionsStore.knownRealms
    .filter((realm) => !known.some((d) => d.realm === realm))
    .map((realm) => ({ id: realm, realm, name: realm, icon: '🖥️' }))
  return [...known, ...extra]
})

// A card's image is just that machine's cached wallpaper — a per-window
// screenshot was tried and dropped: it wasn't reliably accurate (stale or
// blank captures), so this favors "always correct, sometimes generic" over
// "sometimes wrong."
const cardImages = ref<Record<string, string | null>>({})

function setCardImage(realm: string, url: string | null) {
  const prev = cardImages.value[realm]
  if (prev && prev !== url) URL.revokeObjectURL(prev)
  cardImages.value[realm] = url
}

async function loadCardImages() {
  for (const desktop of displayDesktops.value) {
    const wallpaper = await loadCachedWallpaper(desktop.realm)
    setCardImage(desktop.realm, wallpaper?.url ?? null)
  }
}

watch(
  () => machinesOverviewStore.isOpen,
  (open) => {
    if (open) loadCardImages()
  },
)

function selectMachine(realm: string, name: string) {
  machinesOverviewStore.close()
  openLauncher(realm, name)
}

function onKeydown(e: KeyboardEvent) {
  if (!machinesOverviewStore.isOpen) return
  if (e.key === 'Escape') machinesOverviewStore.close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="machines-overview"
    v-show="machinesOverviewStore.isOpen"
    @click.self="machinesOverviewStore.close()"
    @contextmenu.prevent
  >
    <div class="machines-overview-header">
      <h2 class="machines-overview-title">Machines</h2>
      <button class="machines-overview-close" @click="machinesOverviewStore.close()">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>

    <div class="machines-grid">
      <div
        v-for="desktop in displayDesktops"
        :key="desktop.realm"
        class="machines-card"
        @click="selectMachine(desktop.realm, desktop.name)"
      >
        <div class="machines-card-preview">
          <img v-if="cardImages[desktop.realm]" :src="cardImages[desktop.realm]!" alt="" class="machines-card-image" />
          <div v-else class="machines-card-placeholder">
            <i class="bi bi-pc-display"></i>
          </div>
        </div>
        <div class="machines-card-name">
          <span aria-hidden="true">{{ desktop.icon }}</span>
          {{ desktop.name }}
        </div>
      </div>

      <div v-if="displayDesktops.length === 0" class="machines-empty">No machines found</div>
    </div>
  </div>
</template>

<style scoped>
.machines-overview {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 2.5rem 3rem;
  background: rgba(15, 23, 42, 0.82);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow-y: auto;
}

.machines-overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.machines-overview-title {
  color: #fff;
  font-weight: 700;
  margin: 0;
}

.machines-overview-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.machines-overview-close:hover {
  background: rgba(255, 255, 255, 0.22);
}

.machines-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1.75rem;
  align-content: flex-start;
}

.machines-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  cursor: pointer;
  width: 240px;
}

.machines-card-preview {
  position: relative;
  width: 240px;
  height: 150px;
  border-radius: 10px;
  overflow: hidden;
  background: #1e293b;
  border: 2px solid rgba(255, 255, 255, 0.15);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.machines-card:hover .machines-card-preview {
  border-color: rgba(255, 255, 255, 0.6);
  transform: translateY(-3px);
}

.machines-card-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
}

.machines-card-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 2rem;
}

.machines-card-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.machines-empty {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
}
</style>
