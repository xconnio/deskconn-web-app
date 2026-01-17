<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

onMounted(async () => {
  try {
    const success = await authStore.autoLogin()
    if (success) {
      if (
        router.currentRoute.value.path === '/login' ||
        router.currentRoute.value.path === '/register'
      ) {
        router.push('/')
      }
    } else {
      // Check if auth is required for current route?
      // The router guards handle this mostly, but if we are on a protected route and auto-login fails,
      // we might want to redirect. But usually router guard does it.
    }
  } catch (err) {
    console.error('Auto-login failed', err)
    authStore.logout() // Ensure clean state
    if (router.currentRoute.value.path !== '/login') {
      router.push('/login')
    }
  }
})
</script>

<template>
  <div class="min-vh-100 d-flex flex-column bg-light">
    <!-- Header -->
    <header class="navbar navbar-expand-lg header-theme">
      <div class="container-fluid">
        <router-link to="/" class="navbar-brand mb-0 h1 fw-bold ps-3 text-dark text-decoration-none"
          >Deskconn</router-link
        >

        <div class="d-flex align-items-center me-3" v-if="authStore.isAuthenticated">
          <span class="me-3 text-dark"
            >Hello, {{ authStore.user?.name || authStore.user?.email }}</span
          >
          <a href="#" class="text-danger text-decoration-none" @click.prevent="handleLogout"
            >Logout</a
          >
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow-1 d-flex flex-column">
      <!-- Views are now responsible for their own layout (containers, centering, etc) -->
      <RouterView />
    </main>
  </div>
</template>

<style>
/* Global styles if needed, though Bootstrap handles most */
body {
  background-color: #f8f9fa;
}
</style>
