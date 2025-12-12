<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Modal } from 'bootstrap'

const loginSuccessModal = ref<HTMLElement | null>(null)
let modalInstance: Modal | null = null

const form = ref({
  username: '',
  password: '',
})

const error = ref('')

onMounted(() => {
  if (loginSuccessModal.value) {
    modalInstance = new Modal(loginSuccessModal.value)
  }
})

const handleLogin = () => {
  const users = JSON.parse(localStorage.getItem('users') || '[]')

  const user = users.find(
    (u: Record<string, string>) =>
      u.username === form.value.username && u.password === form.value.password,
  )

  if (user) {
    error.value = ''
    modalInstance?.show()
  } else {
    error.value = 'Invalid username or password'
  }
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
          <button type="submit" class="btn btn-success">Login</button>
        </div>
        <div class="text-center mt-3">
          <small
            >Don't have an account? <router-link to="/register">Register here</router-link></small
          >
        </div>
      </form>
    </div>
  </div>

  <!-- Success Modal -->
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
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>
