<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'bootstrap'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const loginSuccessModal = ref<HTMLElement | null>(null)
let modalInstance: Modal | null = null

// Form State
const form = ref({
  username: '',
  password: '',
})

const error = ref('')

onMounted(() => {
  if (loginSuccessModal.value) {
    modalInstance = new Modal(loginSuccessModal.value)
    loginSuccessModal.value.addEventListener('hidden.bs.modal', () => {
      if (authStore.isAuthenticated) {
        router.push('/')
      }
    })
  }
})

const handleLogin = async () => {
  try {
    error.value = ''

    // Call store action
    await authStore.login(form.value.username, form.value.password)

    // Show modal or redirect? Project says "if login succeed don't show any alert and redirect to root path"
    // So I will just redirect. The modal was from previous iteration but might be removable now.
    // I'll keep the redirect simple.
    router.push('/')
  } catch (e: unknown) {
    console.error(e)
    const errorMsg = e instanceof Error ? e.message : String(e)
    error.value = 'Login failed: ' + errorMsg
  }
}

const handleSuccessConfirm = () => {
  modalInstance?.hide()
  router.push('/')
}
</script>

<template>
  <div class="card shadow-sm">
    <div class="card-body p-4">
      <h3 class="card-title text-center mb-4">Login</h3>

      <div v-if="error" class="alert alert-danger" role="alert">
        {{ error }}
      </div>

      <form @submit.prevent="handleLogin">
        <div class="mb-3">
          <label for="username" class="form-label">Username</label>
          <input
            type="text"
            class="form-control"
            id="username"
            v-model="form.username"
            required
            placeholder="Enter your username"
          />
        </div>
        <div class="mb-3">
          <label for="password" class="form-label">Password</label>
          <input
            type="password"
            class="form-control"
            id="password"
            v-model="form.password"
            required
            placeholder="Enter your password"
          />
        </div>
        <div class="d-grid gap-2">
          <button type="submit" class="btn btn-primary">Login</button>
        </div>
        <div class="text-center mt-3">
          <small
            >Don't have an account? <router-link to="/register">Register here</router-link></small
          >
        </div>
      </form>
    </div>
  </div>

  <!-- Success Modal (Kept if needed, but unused in favored flow) -->
  <div
    class="modal fade"
    id="successModal"
    tabindex="-1"
    ref="loginSuccessModal"
    aria-hidden="true"
  >
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-success text-white">
          <h5 class="modal-title">Success</h5>
          <button
            type="button"
            class="btn-close"
            data-bs-dismiss="modal"
            aria-label="Close"
          ></button>
        </div>
        <div class="modal-body">Login Successful!</div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary" @click="handleSuccessConfirm">Okay</button>
        </div>
      </div>
    </div>
  </div>
</template>
