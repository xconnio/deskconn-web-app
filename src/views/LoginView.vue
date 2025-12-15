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
  email: '',
  password: '',
})

const error = ref('')

const validateEmail = (email: string) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    )
}

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

    if (!form.value.email || !validateEmail(form.value.email)) {
      error.value = 'Please enter a valid email address.'
      return
    }

    if (!form.value.password) {
      error.value = 'Password is required.'
      return
    }

    // Call store action
    await authStore.login(form.value.email, form.value.password)

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
  <div class="row justify-content-center align-items-center flex-grow-1 w-100 m-0">
    <div class="col-md-6 col-lg-4">
      <div class="card shadow-lg border-0 fade-in-up">
        <div class="card-body p-5">
          <div class="text-center mb-5">
            <h3 class="card-title fw-bold">Welcome Back</h3>
            <p class="text-muted text-sm">Login to your account</p>
          </div>

          <div v-if="error" class="alert alert-danger d-flex align-items-center" role="alert">
            <span>{{ error }}</span>
          </div>

          <form @submit.prevent="handleLogin">
            <div class="mb-4">
              <label for="email" class="form-label">Email</label>
              <input
                type="email"
                class="form-control form-control-lg"
                id="email"
                v-model="form.email"
                required
                placeholder="name@example.com"
                autocomplete="email"
              />
            </div>
            <div class="mb-4">
              <label for="password" class="form-label">Password</label>
              <input
                type="password"
                class="form-control form-control-lg"
                id="password"
                v-model="form.password"
                required
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </div>

            <div class="d-flex justify-content-between align-items-center mb-4">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="rememberMe" />
                <label class="form-check-label text-muted" for="rememberMe"> Remember me </label>
              </div>
              <router-link
                to="/forgot-password"
                class="text-primary text-decoration-none small fw-bold"
                >Forgot password?</router-link
              >
            </div>

            <div class="d-grid gap-2 mt-4">
              <button type="submit" class="btn btn-primary btn-lg">Login</button>
            </div>
            <div class="text-center mt-4">
              <span class="text-muted">Don't have an account? </span>
              <router-link to="/register" class="fw-bold">Sign up</router-link>
            </div>
          </form>
        </div>
      </div>
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
