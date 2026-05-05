<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EmbeddedDesktopFileExplorer from '@/components/EmbeddedDesktopFileExplorer.vue'

const route = useRoute()
const router = useRouter()

const realm = computed(() => String(route.params.realm || ''))
const desktopName = computed(() => {
  const queryName = route.query.name
  return typeof queryName === 'string' ? queryName : undefined
})

const explorerRef = ref<InstanceType<typeof EmbeddedDesktopFileExplorer> | null>(null)

function closeExplorer() {
  router.push('/')
}
</script>

<template>
  <div class="file-explorer-page fade-in-up">
    <div class="page-topbar">
      <button class="btn btn-link text-decoration-none px-0 back-link" @click="closeExplorer">
        <i class="bi bi-arrow-left me-2"></i>Back to dashboard
      </button>
      <button
        class="btn btn-dark rounded-pill px-3 refresh-btn"
        @click="explorerRef?.refreshCurrentPath()"
        :disabled="explorerRef?.isLoading || explorerRef?.isConnecting"
      >
        <i class="bi bi-arrow-clockwise"></i><span class="btn-text ms-2">Refresh</span>
      </button>
    </div>
    <EmbeddedDesktopFileExplorer
      ref="explorerRef"
      :realm="realm"
      :desktop-name="desktopName"
    />
  </div>
</template>

<style scoped>
.file-explorer-page {
  padding: 0.6rem 1rem 1.5rem;
}

.page-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.back-link {
  color: #617182;
  font-weight: 600;
}

.back-link:hover {
  color: #1f2a37;
}

@media (min-width: 768px) {
  .file-explorer-page {
    padding: 0.75rem 1.75rem 1.5rem;
    min-height: 100dvh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .btn-text {
    display: none;
  }

  .refresh-btn {
    padding-left: 0.65rem;
    padding-right: 0.65rem;
  }
}
</style>
