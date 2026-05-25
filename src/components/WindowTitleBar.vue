<script setup lang="ts">
const isMac = /Macintosh/.test(navigator.userAgent)

defineEmits<{ close: [] }>()
</script>

<template>
  <div class="win-titlebar" :class="[isMac ? 'is-mac' : 'is-win']">
    <div class="win-title">
      <slot />
    </div>
    <button class="tbar-close" title="Close" @click="$emit('close')">
      <i class="bi bi-x-lg"></i>
    </button>
  </div>
</template>

<style scoped>
.win-titlebar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--tbar-border);
  background: var(--tbar-bg);
  flex-shrink: 0;
  user-select: none;
}

/* macOS: close button moves to the left */
.win-titlebar.is-mac .tbar-close {
  order: -1;
}

/* Windows/Linux: title fills space, close button is pushed to the right */
.win-titlebar.is-win .win-title {
  flex: 1;
}

.win-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--tbar-text);
  min-width: 0;
  line-height: 1;
}

.win-title :deep(i.bi) {
  font-size: 0.9rem;
  line-height: 1;
  flex-shrink: 0;
}

.win-title :deep(span) {
  line-height: 1;
}

.tbar-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--tbar-btn);
  font-size: 0.75rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.tbar-close:hover {
  background: var(--tbar-btn-hover-bg);
  color: var(--tbar-btn-hover-color);
}

.win-titlebar {
  --tbar-bg: #ffffff;
  --tbar-border: #e8ecf0;
  --tbar-text: #1e293b;
  --tbar-btn: #64748b;
  --tbar-btn-hover-bg: #f1f5f9;
  --tbar-btn-hover-color: #111827;
}
</style>
