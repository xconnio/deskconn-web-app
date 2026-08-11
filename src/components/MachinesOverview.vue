<script setup lang="ts">
import { ref, computed, onMounted, type ComponentPublicInstance } from 'vue'
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

onMounted(loadCardImages)

// Registers this card's slot for DesktopSessionHost to teleport its live desktop into.
function setPreviewTarget(realm: string, el: Element | null) {
  if (el) machinesOverviewStore.registerPreviewTarget(realm, el as HTMLElement)
  else machinesOverviewStore.unregisterPreviewTarget(realm)
}

// Cached per realm — Vue calls a template ref function on every render of
// the owner regardless of the callback's identity, so this doesn't avoid
// that; it just avoids allocating a new function each render.
type TemplateRefCallback = (el: Element | ComponentPublicInstance | null) => void
const previewRefCallbacks = new Map<string, TemplateRefCallback>()
function previewRef(realm: string): TemplateRefCallback {
  let fn = previewRefCallbacks.get(realm)
  if (!fn) {
    fn = (el) => setPreviewTarget(realm, el as Element | null)
    previewRefCallbacks.set(realm, fn)
  }
  return fn
}

function selectMachine(realm: string, name: string) {
  openLauncher(realm, name)
}
</script>

<template>
  <div class="machines-overview">
    <div class="machines-overview-header">
      <h2 class="machines-overview-title">Machines</h2>
    </div>

    <div v-if="!machinesStore.hasLoadedDesktops" class="machines-loading">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>

    <div v-else class="machines-grid">
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

          <div class="preview-live" :ref="previewRef(desktop.realm)"></div>

          <!-- Blocks clicks/drags into the live-teleported desktop so the card still just selects the machine. -->
          <div class="preview-shield"></div>
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
  background: #0f172a;
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

.machines-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.machines-loading .spinner-border {
  color: rgba(255, 255, 255, 0.85);
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

.preview-live {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.preview-shield {
  position: absolute;
  inset: 0;
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
