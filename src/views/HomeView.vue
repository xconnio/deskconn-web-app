<script setup lang="ts">
import { openLauncher } from '../router/navigation'
import { useMachinesStore } from '../stores/machines'

const machinesStore = useMachinesStore()
</script>

<template>
  <div class="container py-3 py-md-5 fade-in-up">
    <div class="row justify-content-center mb-5">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-secondary me-3 p-2">
              <i class="bi bi-pc-display"></i>
            </span>
            Machines
          </h3>
        </div>

        <div v-if="machinesStore.isLoadingDesktops" class="row g-4">
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
          <div v-for="desktop in machinesStore.desktops" :key="desktop.realm" class="col-md-4">
            <div
              class="card h-100 border-0 shadow-sm card-hover desktop-card"
              @click="openLauncher(desktop.realm, desktop.name)"
            >
              <div class="card-body p-4 d-flex flex-column">
                <div class="d-flex align-items-center mb-3">
                  <span class="fs-2 me-3">{{ desktop.icon }}</span>
                  <div>
                    <h5 class="card-title mb-0 text-dark">{{ desktop.name }}</h5>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!machinesStore.isLoadingDesktops && machinesStore.desktops.length === 0" class="col-12">
          <div class="card border-dashed p-5 text-center bg-transparent">
            <p class="text-muted mb-0">No machines found</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
