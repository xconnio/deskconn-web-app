<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EmbeddedDesktopFileExplorer from '@/components/EmbeddedDesktopFileExplorer.vue'

const route = useRoute()
const router = useRouter()

const realm = computed(() => String(route.params.realm || ''))
const desktopName = computed(() => {
  const queryName = route.query.name
  return typeof queryName === 'string' ? queryName : undefined
})

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
    </div>
    <EmbeddedDesktopFileExplorer
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
</style>
