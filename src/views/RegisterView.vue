<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  username: '',
  name: '',
  password: '',
})

const handleRegister = async () => {
  try {
    // Call store action
    await authStore.register(form.value)

    // Redirecting to login as per user request
    router.push('/login')
  } catch (err) {
    console.error('Registration failed', err)
    alert('Registration failed: ' + err)
  }
}
</script>

<template>
  <div class="card shadow-sm">
    <div class="card-body p-4">
      <h3 class="card-title text-center mb-4">Register</h3>
      <form @submit.prevent="handleRegister">
        <div class="mb-3">
          <label for="name" class="form-label">Full Name</label>
          <input
            type="text"
            class="form-control"
            id="name"
            v-model="form.name"
            required
            placeholder="Enter your full name"
          />
        </div>
        <div class="mb-3">
          <label for="username" class="form-label">Username</label>
          <input
            type="text"
            class="form-control"
            id="username"
            v-model="form.username"
            required
            placeholder="Choose a username"
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
            placeholder="Create a password"
          />
        </div>
        <div class="d-grid gap-2">
          <button type="submit" class="btn btn-primary">Register</button>
        </div>
        <div class="text-center mt-3">
          <small>Already have an account? <router-link to="/login">Login here</router-link></small>
        </div>
      </form>
    </div>
  </div>
</template>
