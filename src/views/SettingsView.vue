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
          <div class="card-body py-4">
            <div class="d-flex align-items-center justify-content-between">
              <p class="mb-0 fw-semibold">Use WebRTC</p>
              <div class="ms-4 flex-shrink-0">
                <div class="form-check form-switch mb-0">
                  <input
                    class="form-check-input webrtc-toggle"
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
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.webrtc-toggle {
  width: 3rem;
  height: 1.6rem;
  cursor: pointer;
}
</style>
