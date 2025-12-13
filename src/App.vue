<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { connectCryptosign } from 'xconn'
import { WAMP_URL, WAMP_REALM } from './config'

const router = useRouter()
const authStore = useAuthStore()

const handleLogout = () => {
  authStore.logout()
  // Only clear the "last active" pointer, but keep the device credentials
  // so we can reuse them if this specific user logs in again.
  localStorage.removeItem('last_active_user')
  router.push('/login')
}

onMounted(async () => {
  const lastUserId = localStorage.getItem('last_active_user')
  const storedUserStr = localStorage.getItem('currentUser')

  if (lastUserId && storedUserStr) {
    const storageKey = `device_credentials_${lastUserId}`
    const storedCredsStr = localStorage.getItem(storageKey)
    const storedUser = JSON.parse(storedUserStr)
    const authId = storedUser.username || storedUser.email

    if (storedCredsStr && authId) {
      const { privateKey } = JSON.parse(storedCredsStr)

      try {
        console.log('Attempting auto-login with username and persistent device key...')
        console.log('AuthID:', authId)

        const session = await connectCryptosign(WAMP_URL, WAMP_REALM, authId, privateKey)

        console.log('Session connected. Fetching account details...')
        const result = await session.call('io.xconn.deskconn.account.get')
        const userDetails = result.args?.[0] || result

        console.dir(userDetails)
        authStore.login(userDetails)

        if (
          router.currentRoute.value.path === '/login' ||
          router.currentRoute.value.path === '/register'
        ) {
          router.push('/')
        }
      } catch (err) {
        console.error('Auto-login failed', err)
        authStore.logout()
        // If auto-login fails, maybe clear the last active user so we don't loop?
        localStorage.removeItem('last_active_user')
        if (router.currentRoute.value.path !== '/login') {
          router.push('/login')
        }
      }
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
            >Hello, {{ authStore.user?.name || authStore.user?.username }}</span
          >
          <a href="#" class="text-danger text-decoration-none" @click.prevent="handleLogout"
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
