<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
import { useMachinesStore } from '@/stores/machines'
import { useDesktopSessionsStore } from '@/stores/desktopSessions'
import { useMachinesOverviewStore } from '@/stores/machinesOverview'
import { openLauncher } from '@/router/navigation'
import { machinesOverviewReturnRealm } from '@/router/index'
import { loadCachedWallpaper } from '@/composables/useWallpaperCache'
import { useEntryNavigation } from '@/composables/useEntryNavigation'

interface DesktopCard { id: string; realm: string; name: string; icon: string }

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

// Only shown when this overview was reached from a desktop (e.g. the dock's
// Machines button) — nothing to close back to when it's the initial landing page.
function closeOverview() {
  if (machinesOverviewReturnRealm.value) openLauncher(machinesOverviewReturnRealm.value)
}

const machinesGridRef = ref<HTMLElement | null>(null)
const selectedDesktop = ref<DesktopCard | null>(null)

// Keyboard nav starts from the machine already open (if any) rather than
// jumping to the first card — set once, as soon as the list carries it, and
// left alone after that so it doesn't fight the user's own navigation.
watch(
  displayDesktops,
  (list) => {
    if (selectedDesktop.value) return
    const active = list.find((d) => d.realm === machinesOverviewReturnRealm.value)
    if (active) selectedDesktop.value = active
  },
  { immediate: true },
)

const { handleNavKey } = useEntryNavigation({
  entries: () => displayDesktops.value,
  getKey: (d) => d.realm,
  selected: selectedDesktop,
  listRef: machinesGridRef,
  isGrid: () => true,
  onOpen: (d) => selectMachine(d.realm, d.name),
  activeSelector: '.machines-card.kbd-focused',
})

// Capture phase + stopPropagation so this consumes the key before it also
// reaches the focused app's own document-level keydown listener underneath.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); closeOverview(); return }
  if (handleNavKey(e)) e.stopPropagation()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="machines-overview">
    <div class="machines-overview-header">
      <h2 class="machines-overview-title">Machines</h2>
      <button
        v-if="machinesOverviewReturnRealm"
        class="machines-overview-close"
        title="Close"
        @click="closeOverview"
      >
        <i class="bi bi-x-lg"></i>
      </button>
    </div>

    <div v-if="!machinesStore.hasLoadedDesktops" class="machines-loading">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>

    <div v-else ref="machinesGridRef" class="machines-grid">
      <div
        v-for="desktop in displayDesktops"
        :key="desktop.realm"
        class="machines-card"
        :class="{
          'machines-card-active': desktop.realm === machinesOverviewReturnRealm,
          'kbd-focused': desktop.realm === selectedDesktop?.realm,
        }"
        tabindex="-1"
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
  flex: 1;
  min-height: 0;
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
  display: grid;
  grid-template-columns: repeat(auto-fill, 240px);
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

.machines-card:focus {
  outline: none;
}

.machines-card.kbd-focused .machines-card-preview {
  outline: 2px solid #60a5fa;
  outline-offset: 3px;
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

.machines-card-active .machines-card-preview {
  border-color: #3b82f6;
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
