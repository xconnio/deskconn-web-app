<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
</script>

<template>
  <div class="container py-5 fade-in-up">
    <div class="row justify-content-center">
      <div class="col-lg-10">
        <h3 class="mb-0 d-flex align-items-center">
          <span class="badge bg-secondary me-3 p-2">
            <i class="bi bi-gear"></i>
          </span>
          Settings
        </h3>

        <div class="card border-0 shadow-sm mt-4">
          <div class="card-body py-4 settings-group">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <p class="mb-0 fw-semibold">Use WebRTC</p>
              </div>
              <div class="ms-4 flex-shrink-0">
                <div class="form-check form-switch mb-0">
                  <input
                    class="form-check-input settings-toggle"
                    type="checkbox"
                    role="switch"
                    id="webrtcToggle"
                    :checked="settingsStore.useWebRTC"
                    @change="settingsStore.setUseWebRTC(($event.target as HTMLInputElement).checked)"
                  />
                  <label class="form-check-label visually-hidden" for="webrtcToggle">
                    Use WebRTC
                  </label>
                </div>
              </div>
            </div>

            <hr class="settings-divider" />

            <div class="d-flex align-items-center justify-content-between">
              <p class="mb-0 fw-semibold">Single click to open</p>
              <div class="ms-4 flex-shrink-0">
                <div class="form-check form-switch mb-0">
                  <input
                    class="form-check-input settings-toggle"
                    type="checkbox"
                    role="switch"
                    id="singleClickToggle"
                    :checked="settingsStore.singleClickOpen"
                    @change="settingsStore.setSingleClickOpen(($event.target as HTMLInputElement).checked)"
                  />
                  <label class="form-check-label visually-hidden" for="singleClickToggle">
                    Single click to open
                  </label>
                </div>
              </div>
            </div>

            <hr class="settings-divider" />

            <div class="d-flex align-items-center justify-content-between">
              <div>
                <p class="mb-0 fw-semibold">Resource Monitor refresh interval</p>
              </div>
              <div class="ms-4 flex-shrink-0">
                <select
                  class="form-select form-select-sm settings-select"
                  :value="settingsStore.resourceMonitorInterval"
                  @change="settingsStore.setResourceMonitorInterval(parseInt(($event.target as HTMLSelectElement).value, 10))"
                >
                  <option value="1">1 second</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </div>
            </div>

            <hr class="settings-divider" />

            <div class="d-flex align-items-center justify-content-between">
              <div>
                <p class="mb-0 fw-semibold">Use remote wallpaper</p>
              </div>
              <div class="ms-4 flex-shrink-0">
                <div class="form-check form-switch mb-0">
                  <input
                    class="form-check-input settings-toggle"
                    type="checkbox"
                    role="switch"
                    id="remoteWallpaperToggle"
                    :checked="settingsStore.useRemoteWallpaper"
                    @change="settingsStore.setUseRemoteWallpaper(($event.target as HTMLInputElement).checked)"
                  />
                  <label class="form-check-label visually-hidden" for="remoteWallpaperToggle">
                    Use remote wallpaper
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-toggle {
  width: 3rem;
  height: 1.6rem;
  cursor: pointer;
}

.settings-divider {
  margin: 1rem 0;
  border-color: #e8ecf0;
}

.settings-select {
  min-width: 120px;
  cursor: pointer;
}
</style>
