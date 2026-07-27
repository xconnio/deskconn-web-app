<script setup lang="ts">
import { formatSize } from '@/utils/fileTypes'
import type { DownloadProgressState } from '@/utils/fileDownload'

defineProps<{ progress: DownloadProgressState }>()
</script>

<template>
  <Teleport to="body">
    <div class="dl-toast">
      <div class="dl-toast-header">
        <i class="bi bi-download dl-toast-icon"></i>
        <span class="dl-toast-title">Downloading</span>
        <button class="dl-toast-cancel" @click="progress.cancel()" title="Cancel">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="dl-toast-name">{{ progress.name }}</div>
      <div class="dl-progress-bar-wrap">
        <div
          class="dl-progress-bar"
          :style="{ width: progress.total > 0 ? `${Math.min(100, Math.round(progress.received / progress.total * 100))}%` : '0%' }"
        ></div>
      </div>
      <div class="dl-toast-meta">
        <span>{{ formatSize(progress.received) }} / {{ progress.total > 0 ? formatSize(progress.total) : '…' }}</span>
        <span>{{ progress.speed > 0 ? `${formatSize(Math.round(progress.speed))}/s` : '…' }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dl-toast {
  position: fixed;
  bottom: 1.25rem;
  right: 1.25rem;
  width: 280px;
  background: #1e293b;
  border-radius: 14px;
  padding: 0.85rem 1rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 3000;
}
.dl-toast-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
.dl-toast-icon { color: #60a5fa; font-size: 0.9rem; }
.dl-toast-title { font-size: 0.8rem; font-weight: 700; color: #f1f5f9; flex: 1; }
.dl-toast-cancel { background: transparent; border: 0; color: #94a3b8; font-size: 0.8rem; cursor: pointer; padding: 0; display: flex; }
.dl-toast-cancel:hover { color: #f1f5f9; }
.dl-toast-name { font-size: 0.75rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.5rem; }
.dl-progress-bar-wrap { height: 4px; background: #334155; border-radius: 2px; margin-bottom: 0.35rem; }
.dl-progress-bar { height: 100%; background: #60a5fa; border-radius: 2px; transition: width 0.3s; }
.dl-toast-meta { display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b; }
</style>
