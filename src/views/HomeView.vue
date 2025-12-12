<script setup lang="ts">
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
</script>

<template>
  <div class="card shadow-sm">
    <div class="card-body p-5 text-center">
      <h2 class="card-title mb-4">
        Welcome, {{ authStore.user?.name || authStore.user?.username }}!
      </h2>
      <p class="card-text text-muted">You have successfully logged in.</p>
    </div>
  </div>
</template>
