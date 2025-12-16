<script setup lang="ts">
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
</script>

<template>
  <div class="row justify-content-center align-items-center flex-grow-1 w-100 m-0">
    <div class="col-md-8 col-lg-6">
      <div class="card shadow-lg border-0 fade-in-up">
        <div class="card-body p-5 text-center">
          <h2 class="card-title fw-bold mb-4">
            Welcome, {{ authStore.user?.name || authStore.user?.username }}!
          </h2>
          <p class="card-text text-muted mb-4">You have successfully logged in.</p>
          <div class="d-grid gap-2 d-sm-flex justify-content-sm-center">
            <!-- Placeholder for dashboard actions if needed later -->
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
