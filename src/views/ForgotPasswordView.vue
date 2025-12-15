<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import VOtpInput from 'vue3-otp-input'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

// State
const step = ref(1) // 1: Email, 2: OTP + New Password
const isLoading = ref(false)
const error = ref('')
const otpInput = ref<InstanceType<typeof VOtpInput> | null>(null)

// Form Models
const email = ref('')
const otp = ref('')
const password = ref('')
const confirmPassword = ref('')

// Validation Logic
const validateEmail = (emailStr: string) => {
  return String(emailStr)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    )
}

const validatePassword = (pwd: string) => {
  if (pwd.length < 8) return false
  if (!/[A-Z]/.test(pwd)) return false
  if (!/[^a-zA-Z0-9]/.test(pwd)) return false
  return true
}

// Handlers
const handleSendOtp = async () => {
  error.value = ''
  if (!email.value || !validateEmail(email.value)) {
    error.value = 'Please enter a valid email address.'
    return
  }

  isLoading.value = true
  try {
    await authStore.forgotPassword(email.value)
    // If successful, move to step 2
    step.value = 2
  } catch (err: unknown) {
    console.error(err)
    const msg = err instanceof Error ? err.message : String(err)
    error.value = 'Failed to send OTP: ' + msg
  } finally {
    isLoading.value = false
  }
}

const handleOtpChange = (value: string) => {
  otp.value = value
}

const handleOtpComplete = (value: string) => {
  otp.value = value
}

const handleReset = async () => {
  error.value = ''

  // Client-side validations
  if (!otp.value || otp.value.length < 6) {
    error.value = 'Please enter a valid 6-digit OTP.'
    return
  }

  if (!validatePassword(password.value)) {
    error.value =
      'Password must be at least 8 characters long, contain at least one capital letter and one symbol.'
    return
  }

  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }

  isLoading.value = true
  try {
    // Corrected arg order: email, password, otp
    await authStore.resetPassword(email.value, password.value, otp.value)
    // On success, redirect to login
    router.push('/login')
  } catch (err: unknown) {
    console.error(err)
    const msg = err instanceof Error ? err.message : String(err)
    error.value = 'Reset failed: ' + msg
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
            <h3 class="card-title fw-bold">
              {{ step === 1 ? 'Forgot Password' : 'Reset Password' }}
            </h3>
            <p class="text-muted text-sm">
              {{ step === 1 ? 'Enter your email to verify' : 'Secure your account' }}
            </p>
          </div>

          <div v-if="error" class="alert alert-danger d-flex align-items-center mb-4" role="alert">
            <i class="bi bi-exclamation-circle-fill me-2"></i>
            <span>{{ error }}</span>
          </div>

          <!-- Step 1: Email Form -->
          <form v-if="step === 1" @submit.prevent="handleSendOtp">
            <div class="mb-4">
              <label for="email" class="form-label">Email</label>
              <input
                type="email"
                class="form-control form-control-lg"
                id="email"
                v-model="email"
                required
                placeholder="name@example.com"
                autocomplete="email"
                :disabled="isLoading"
              />
            </div>

            <div class="d-grid gap-2 mt-4">
              <button type="submit" class="btn btn-primary btn-lg" :disabled="isLoading">
                <span
                  v-if="isLoading"
                  class="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                ></span>
                {{ isLoading ? 'Sending...' : 'Send OTP' }}
              </button>
            </div>
          </form>

          <!-- Step 2: OTP & Password Form -->
          <form v-else @submit.prevent="handleReset">
            <div class="mb-4">
              <label for="otp" class="form-label d-block text-start">OTP Code</label>
              <div class="d-flex justify-content-center mb-2">
                <v-otp-input
                  ref="otpInput"
                  input-classes="otp-input form-control text-center mx-1 fs-4 fw-bold"
                  separator=""
                  :num-inputs="6"
                  :should-auto-focus="true"
                  :is-input-num="true"
                  :conditionalClass="['one', 'two', 'three', 'four', 'five', 'six']"
                  @on-change="handleOtpChange"
                  @on-complete="handleOtpComplete"
                />
              </div>
            </div>

            <div class="mb-4">
              <label for="newPassword" class="form-label">New Password</label>
              <input
                type="password"
                class="form-control form-control-lg"
                id="newPassword"
                v-model="password"
                required
                placeholder="••••••••"
                autocomplete="new-password"
                :disabled="isLoading"
              />
              <div class="form-text text-muted">
                Must be at least 8 characters, include a capital letter and a symbol.
              </div>
            </div>

            <div class="mb-4">
              <label for="confirmPassword" class="form-label">Confirm Password</label>
              <input
                type="password"
                class="form-control form-control-lg"
                id="confirmPassword"
                v-model="confirmPassword"
                required
                placeholder="••••••••"
                autocomplete="new-password"
                :disabled="isLoading"
              />
            </div>

            <div class="d-grid gap-2 mt-4">
              <button type="submit" class="btn btn-primary btn-lg" :disabled="isLoading">
                <span
                  v-if="isLoading"
                  class="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                ></span>
                {{ isLoading ? 'Reset Password' : 'Reset Password' }}
              </button>
            </div>
          </form>

          <div class="text-center mt-4">
            <span class="text-muted">Remember your password? </span>
            <router-link to="/login" class="fw-bold">Log In</router-link>
            <div v-if="step === 2" class="mt-2">
              <a href="#" class="small text-secondary" @click.prevent="step = 1">Change Email</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.otp-input {
  width: 40px;
  height: 50px;
  padding: 0;
  margin: 0 4px;
  font-size: 1.25rem;
  line-height: 50px;
  font-weight: 700;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  text-align: center;
  background-color: #fff;
  transition: all 0.2s ease;
}
.otp-input:focus {
  border-color: var(--bs-primary);
  box-shadow: 0 0 0 4px rgba(255, 184, 0, 0.25);
  transform: translateY(-2px);
  outline: 0;
}
</style>
