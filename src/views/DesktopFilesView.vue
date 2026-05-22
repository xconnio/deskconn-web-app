<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import EmbeddedDesktopFiles from '@/components/EmbeddedDesktopFiles.vue'
import { openLauncher } from '@/router/navigation'

const route = useRoute()

const realm = computed(() => String(route.params.realm || ''))
const desktopName = computed(() => {
  const queryName = route.query.name
  return typeof queryName === 'string' ? queryName : undefined
})
</script>

<template>
  <div class="file-explorer-page fade-in-up">
    <div class="page-topbar">
      <button class="tbar-btn tbar-close" title="Close" @click="openLauncher(realm, desktopName)">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="page-title">
        <i class="bi bi-display me-2"></i>
        <span>{{ desktopName }}</span>
      </div>
    </div>
    <EmbeddedDesktopFiles
      :realm="realm"
      :desktop-name="desktopName"
    />
  </div>
</template>

<style scoped>
.file-explorer-page {
  padding: 0 1rem 1.5rem;
}

.page-topbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 -1rem 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid #e8ecf0;
}

.page-title {
  color: #1e293b;
  font-weight: 600;
  font-size: 0.95rem;
}

.tbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.tbar-btn:hover {
  background: #f1f5f9;
  color: #111827;
}

@media (min-width: 768px) {
  .file-explorer-page {
    padding: 0 1.75rem 1.5rem;
    min-height: 100dvh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .page-topbar {
    margin: 0 -1.75rem 0.75rem;
    padding: 0.65rem 1.75rem;
  }
}
</style>
