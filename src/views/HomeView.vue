<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'

import { openFileExplorer } from '../router/navigation'
import { useAuthStore } from '../stores/auth'
import { authService } from '../services/authService'
import type { Desktop } from '../types'
import TerminalPanel from '../components/TerminalPanel.vue'

const authStore = useAuthStore()

const desktops = ref<Desktop[]>([])
const isLoadingDesktops = ref(true)
const activeTerminal = ref<{ realm: string; name: string } | null>(null)
let hasTerminalHistoryEntry = false

const openTerminal = (realm: string, name: string) => {
  activeTerminal.value = { realm, name }
}

const closeTerminal = () => {
  if (!activeTerminal.value) return

  if (hasTerminalHistoryEntry) {
    window.history.back()
    return
  }

  activeTerminal.value = null
}

const handlePopState = () => {
  if (!activeTerminal.value) return

  hasTerminalHistoryEntry = false
  activeTerminal.value = null
}

const fetchDesktops = async () => {
  if (!authStore.session) {
    isLoadingDesktops.value = false
    return
  }

  isLoadingDesktops.value = true
  try {
    const result = await authService.listDesktops(authStore.session)
    desktops.value = result.args.map((desktop: Desktop) => ({
      ...desktop,
      icon: '🖥️',
    }))
  } catch (err: unknown) {
    console.error('Failed to fetch desktops', err)
  } finally {
    isLoadingDesktops.value = false
  }
}

watch(
  () => authStore.session,
  (newSession) => {
    if (newSession) {
      fetchDesktops()
    } else {
      isLoadingDesktops.value = false
    }
  },
  { immediate: true },
)

watch(activeTerminal, (next, previous) => {
  if (!next || previous) return

  window.history.pushState({ ...window.history.state, deskconnTerminal: true }, '')
  hasTerminalHistoryEntry = true
})

onMounted(() => {
  window.addEventListener('popstate', handlePopState)
})

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
})
</script>

<template>
  <!-- Terminal view -->
  <div v-if="activeTerminal" class="terminal-view fade-in-up">
    <TerminalPanel
      :realm="activeTerminal.realm"
      :desktop-name="activeTerminal.name"
      @close="closeTerminal"
    />
  </div>

  <!-- Desktops view -->
  <div v-else class="container py-3 py-md-5 fade-in-up">
    <div class="row justify-content-center mb-5">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-secondary me-3 p-2">
              <i class="bi bi-pc-display"></i>
            </span>
            Desktops
          </h3>
        </div>

        <div v-if="isLoadingDesktops" class="row g-4">
          <div v-for="i in 3" :key="i" class="col-md-4">
            <div class="card h-100 border-0 shadow-sm opacity-50">
              <div class="card-body p-4 text-center">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="row g-4">
          <div v-for="desktop in desktops" :key="desktop.realm" class="col-md-4">
            <div
              class="card h-100 border-0 shadow-sm card-hover desktop-card"
              @click="openFileExplorer(desktop.realm, desktop.name)"
            >
              <div class="card-body p-4 d-flex flex-column">
                <div class="d-flex align-items-center mb-3">
                  <span class="fs-2 me-3">{{ desktop.icon }}</span>
                  <div>
                    <h5 class="card-title mb-0 text-dark">{{ desktop.name }}</h5>
                  </div>
                </div>

                <div class="mt-auto d-flex justify-content-between align-items-center">
                  <span class="badge bg-light text-secondary rounded-pill">Open Explorer</span>
                  <button
                    class="btn btn-sm btn-outline-dark"
                    @click.stop="openTerminal(desktop.realm, desktop.name)"
                    title="Open Terminal"
                  >
                    <i class="bi bi-terminal"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!isLoadingDesktops && desktops.length === 0" class="col-12">
          <div class="card border-dashed p-5 text-center bg-transparent">
            <p class="text-muted mb-0">No desktops found</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex: 1;
}

.card-hover {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card-hover:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1) !important;
}

.desktop-card {
  cursor: pointer;
}
</style>
