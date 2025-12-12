<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-vh-100 d-flex flex-column bg-light">
    <!-- Header -->
    <header class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
      <div class="container-fluid">
        <span class="navbar-brand mb-0 h1 fw-bold ps-3">Deskconn</span>

        <div class="d-flex text-white align-items-center me-3" v-if="authStore.isAuthenticated">
          <span class="me-3">Hello, {{ authStore.user?.name || authStore.user?.username }}</span>
          <a href="#" class="text-white text-decoration-none" @click.prevent="handleLogout"
            >Logout</a
          >
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow-1 d-flex align-items-center justify-content-center py-4">
      <div class="container">
        <div class="row justify-content-center">
          <div class="col-12 col-md-6 col-lg-5 col-xl-4">
            <!-- Views render the Card content -->
            <RouterView />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
/* Global styles if needed, though Bootstrap handles most */
body {
  background-color: #f8f9fa;
}
</style>
