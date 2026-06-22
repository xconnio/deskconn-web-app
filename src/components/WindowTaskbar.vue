<script setup lang="ts">
import type { AppWindow } from '@/composables/useWindowManager'

defineProps<{
  windows: AppWindow[]
  focusedId: string | null
}>()

const emit = defineEmits<{
  activate: [id: string]
  close: [id: string]
}>()
</script>

<template>
  <div class="window-taskbar">
    <button
      v-for="win in windows"
      :key="win.id"
      class="taskbar-chip"
      :class="{ 'chip-active': !win.minimized && focusedId === win.id }"
      @click="emit('activate', win.id)"
    >
      <span class="chip-icon" :style="{ color: win.iconColor, background: win.iconBg }">
        <i class="bi" :class="win.icon"></i>
      </span>
      <span class="chip-title">{{ win.title }}</span>
      <span class="chip-close" title="Close" @click.stop="emit('close', win.id)">
        <i class="bi bi-x"></i>
      </span>
    </button>
  </div>
</template>

<style scoped>
.window-taskbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  background: rgba(248, 250, 252, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(232, 236, 240, 0.8);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
  z-index: 10;
  overflow-x: auto;
  min-height: 2.75rem;
  pointer-events: auto;
}

.taskbar-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem 0.3rem 0.4rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.13s ease, background 0.13s ease;
}

.taskbar-chip:hover {
  border-color: #cbd5e1;
}

.taskbar-chip.chip-active {
  background: #dbeafe;
  border-color: rgba(59, 130, 246, 0.28);
}

.chip-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  flex-shrink: 0;
}

.chip-title {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #94a3b8;
  font-size: 0.85rem;
  transition: background 0.13s ease, color 0.13s ease;
}

.chip-close:hover {
  background: #fee2e2;
  color: #dc2626;
}
</style>
