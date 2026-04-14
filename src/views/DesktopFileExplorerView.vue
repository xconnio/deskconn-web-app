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
  <div class="container py-3 py-md-5 px-2 px-md-3 fade-in-up">
    <div class="row justify-content-center">
      <div class="col-12 col-lg-10">
        <div class="mb-4">
          <button class="btn btn-link text-decoration-none px-0 back-link" @click="closeExplorer">
            <i class="bi bi-arrow-left me-2"></i>Back to dashboard
          </button>
        </div>

        <EmbeddedDesktopFileExplorer
          :realm="realm"
          :desktop-name="desktopName"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.back-link {
  color: #617182;
  font-weight: 600;
}

.back-link:hover {
  color: #1f2a37;
}
</style>
