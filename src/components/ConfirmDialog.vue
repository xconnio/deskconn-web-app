<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div v-if="open" class="fs-overlay dialog-overlay" @click.self="emit('cancel')">
    <div class="action-dialog">
      <h4 class="dialog-title">{{ title }}</h4>
      <p class="dialog-body">{{ message }}</p>
      <div class="dialog-actions">
        <button class="dialog-btn" @click="emit('cancel')">{{ cancelLabel ?? 'Cancel' }}</button>
        <button
          class="dialog-btn"
          :class="{ 'dialog-btn-danger': danger ?? true }"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Absolute, not fixed — scopes the overlay to the nearest positioned
   ancestor, which is the FloatingWindow it's rendered inside (always
   position: absolute/fixed itself), instead of covering the whole page. */
.fs-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 2000;
  display: flex;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.dialog-overlay {
  align-items: center;
  padding: 1.25rem;
}

/* GNOME/Adwaita-style dialog: off-white card with a thin border and a soft
   shadow, rather than a pure-white card floating on blur alone. */
.action-dialog {
  background: #fafafa;
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
  animation: dialog-pop 0.16s ease;
}

@keyframes dialog-pop {
  from { transform: scale(0.96); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.dialog-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1e1e1e;
  margin-bottom: 0.5rem;
  overflow-wrap: anywhere;
}

.dialog-body {
  color: #5e5c64;
  font-size: 0.9rem;
  margin-bottom: 1.25rem;
}

.dialog-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 0.55rem 1.1rem;
  border: 1px solid rgba(0, 0, 0, 0.09);
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  background: #e9e9e8;
  color: #1e1e1e;
  cursor: pointer;
  transition: background 0.15s;
  min-width: 80px;
}

.dialog-btn:hover {
  background: #dfdfdd;
}

.dialog-btn-danger {
  background: #e01b24;
  color: #fff;
  border-color: transparent;
}

.dialog-btn-danger:hover {
  background: #c01c28;
}
</style>
