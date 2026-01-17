<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  email: '',
  name: '',
  password: '',
})

const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)

const validateEmail = (email: string) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    )
}

const validatePassword = (password: string) => {
  if (password.length < 8) return false
  if (!/[A-Z]/.test(password)) return false
  // Check for symbol (anything that is not a letter or number)
  if (!/[^a-zA-Z0-9]/.test(password)) return false
  return true
}

const handleRegister = async () => {
  if (isLoading.value) return

  isLoading.value = true
  error.value = ''

  try {
    if (!validateEmail(form.value.email)) {
      throw new Error('Please enter a valid email address.')
    }

    if (!validatePassword(form.value.password)) {
      throw new Error(
        'Password must be at least 8 characters long, contain at least one capital letter and one symbol.',
      )
    }

    // Call store action
    // Map email to username as per store requirement
    await authStore.register({
      username: form.value.email,
      name: form.value.name,
      password: form.value.password,
    })

    // Redirecting to verify as per new flow
    router.push('/verify')
  } catch (err: unknown) {
    console.error('Registration failed', err)
    // Safe error message extraction
    const msg = err instanceof Error ? err.message : String(err)
    error.value = msg || 'Registration failed. Please try again.'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="row justify-content-center align-items-center flex-grow-1 w-100 m-0">
    <div class="col-md-6 col-lg-4">
      <div class="card shadow-lg border-0 fade-in-up">
        <div class="card-body p-5">
          <div class="text-center mb-5">
            <h3 class="card-title fw-bold">Create Account</h3>
            <p class="text-muted text-sm">Join DeskConn today</p>
          </div>

          <div v-if="error" class="alert alert-danger d-flex align-items-center mb-4" role="alert">
            <i class="bi bi-exclamation-circle-fill me-2"></i>
            <!-- Assuming bootstrap-icons or valid CSS icon usage, or just text if no icons -->
            <span>{{ error }}</span>
          </div>

          <form @submit.prevent="handleRegister">
            <div class="mb-4">
              <label for="name" class="form-label">Full Name</label>
              <input
                type="text"
                class="form-control form-control-lg"
                id="name"
                v-model="form.name"
                required
                placeholder="Ex. John Doe"
                :disabled="isLoading"
              />
            </div>
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
                :disabled="isLoading"
              />
            </div>
            <div class="mb-4">
              <label for="password" class="form-label">Password</label>
              <div class="input-group-theme">
                <input
                  :type="showPassword ? 'text' : 'password'"
                  class="form-control form-control-lg pe-5"
                  id="password"
                  v-model="form.password"
                  required
                  placeholder="••••••••"
                  autocomplete="new-password"
                  :disabled="isLoading"
                />
                <button 
                  type="button" 
                  class="btn btn-password-toggle"
                  @click="showPassword = !showPassword"
                  tabindex="-1"
                >
                  <i class="bi" :class="showPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
                </button>
              </div>
              <div class="form-text text-muted">
                Must be at least 8 characters, include a capital letter and a symbol.
              </div>
            </div>

            <div class="d-grid gap-2 mt-5">
              <button type="submit" class="btn btn-primary btn-lg" :disabled="isLoading">
                <span
                  v-if="isLoading"
                  class="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                ></span>
                {{ isLoading ? 'Creating Account...' : 'Sign Up' }}
              </button>
            </div>

            <div class="text-center mt-4">
              <span class="text-muted">Already have an account? </span>
              <router-link to="/login" class="fw-bold">Log In</router-link>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-group-theme {
  position: relative;
  display: flex;
  align-items: center;
}

.btn-password-toggle {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  color: #64748b;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease;
  z-index: 5;
}

.btn-password-toggle:hover {
  color: var(--theme-blue);
}
</style>
