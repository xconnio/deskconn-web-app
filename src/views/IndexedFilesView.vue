<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useMachinesStore } from '@/stores/machines'
import EmbeddedIndexedFiles from '@/components/EmbeddedIndexedFiles.vue'
import WindowTitleBar from '@/components/WindowTitleBar.vue'
import { openLauncher, openFiles } from '@/router/navigation'

const route = useRoute()
const machinesStore = useMachinesStore()

const realm = computed(() => route.params.realm as string)
const category = computed(() => route.params.category as string)
const desktopName = computed(() => {
  const n = route.query.name as string
  if (n) return n
  return machinesStore.desktops.find((d) => d.realm === realm.value)?.name ?? realm.value
})

const viewConfig = computed(() => {
  switch (category.value) {
    case 'pictures':
      return { title: 'Pictures', icon: 'bi-images', color: '#ec4899', bg: '#fce7f3' }
    case 'videos':
      return { title: 'Videos', icon: 'bi-collection-play-fill', color: '#7c3aed', bg: '#ede9fe' }
    default:
      return { title: 'Documents', icon: 'bi-file-earmark-richtext-fill', color: '#d97706', bg: '#fef3c7' }
  }
})

function onOpenFiles(path: string) {
  openFiles(realm.value, desktopName.value, path)
}
</script>

<template>
  <div class="indexed-files-page fade-in-up">
    <WindowTitleBar class="page-topbar" @close="openLauncher(realm, desktopName)">
      <div class="titlebar-content">
        <span class="titlebar-icon" :style="{ color: viewConfig.color, background: viewConfig.bg }">
          <i class="bi" :class="viewConfig.icon"></i>
        </span>
        <span class="titlebar-label">{{ viewConfig.title }}</span>
        <span class="titlebar-machine">{{ desktopName }}</span>
      </div>
    </WindowTitleBar>
    <EmbeddedIndexedFiles
      :realm="realm"
      :category="category"
      :desktop-name="desktopName"
      :focused="true"
      @open-files="onOpenFiles"
    />
  </div>
</template>

<style scoped>
.indexed-files-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0 1rem 1.5rem;
}

:deep(.page-topbar) {
  margin: 0 -1rem 0.75rem;
}

.titlebar-content { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.titlebar-icon {
  width: 26px; height: 26px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.88rem; flex-shrink: 0;
}
.titlebar-label { font-weight: 700; font-size: 0.9rem; color: #1e293b; flex-shrink: 0; }
.titlebar-machine { font-size: 0.78rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titlebar-machine::before { content: '·'; margin-right: 0.35rem; }

@media (min-width: 768px) {
  .indexed-files-page {
    padding: 0 1.75rem 1.5rem;
    min-height: 100dvh;
    box-sizing: border-box;
  }

  :deep(.page-topbar) {
    margin: 0 -1.75rem 0.75rem;
    padding: 0.65rem 1.75rem;
  }
}
</style>
