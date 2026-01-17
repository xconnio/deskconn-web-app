<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const form = ref({
  name: authStore.user?.name || '',
  email: authStore.user?.email || '',
  password: '',
  confirmPassword: '',
})

const isLoading = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

const showPassword = ref(false)
const showConfirmPassword = ref(false)

const validatePassword = (password: string) => {
  if (password.length < 8) return false
  if (!/[A-Z]/.test(password)) return false
  if (!/[^a-zA-Z0-9]/.test(password)) return false
  return true
}

const isPasswordMismatch = computed(() => {
  return form.value.password !== '' && form.value.password !== form.value.confirmPassword
})

const canSubmit = computed(() => {
  const isNameValid = form.value.name.trim().length > 0
  const isPasswordValid = form.value.password === '' || (validatePassword(form.value.password) && !isPasswordMismatch.value)
  return isNameValid && isPasswordValid && !isLoading.value
})

const handleUpdate = async () => {
  if (!canSubmit.value) return

  isLoading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const passwordToUpdate = form.value.password || undefined
    await authStore.updateProfile(form.value.name, passwordToUpdate)
    
    successMessage.value = 'Profile updated successfully!'
    form.value.password = ''
    form.value.confirmPassword = ''
    
    // Clear success message after 3 seconds
    setTimeout(() => {
      successMessage.value = ''
    }, 3000)
  } catch (err: unknown) {
    console.error('Profile update failed', err)
    errorMessage.value = err instanceof Error ? err.message : 'Failed to update profile'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  if (!authStore.user) {
    router.push('/login')
  }
})
</script>

<template>
  <div class="container pt-5 pb-5 fade-in-up">
    <!-- Navigation -->
    <div class="row mb-2 justify-content-center">
      <div class="col-lg-6">
        <router-link to="/" class="btn btn-link text-decoration-none text-muted p-0 d-flex align-items-center back-link">
          <i class="bi bi-arrow-left-short fs-2 me-1"></i>
          <span class="fw-semibold">Back to Dashboard</span>
        </router-link>
      </div>
    </div>

    <div class="row justify-content-center">
      <div class="col-lg-6">
        <div class="card glass-modal border-0 shadow-lg">
          <div class="card-body p-5 pt-4">
            <div class="text-center mb-5">
              <h2 class="fw-bold mb-1">Profile Settings</h2>
              <p class="text-muted mb-0">Manage your account information</p>
            </div>

            <!-- Alerts -->
            <div v-if="successMessage" class="alert alert-success d-flex align-items-center mb-4 border-0 shadow-sm" role="alert">
              <i class="bi bi-check-circle-fill me-2"></i>
              <div>{{ successMessage }}</div>
            </div>

            <div v-if="errorMessage" class="alert alert-danger d-flex align-items-center mb-4 border-0 shadow-sm" role="alert">
              <i class="bi bi-exclamation-triangle-fill me-2"></i>
              <div>{{ errorMessage }}</div>
            </div>

            <form @submit.prevent="handleUpdate">
              <div class="mb-3">
                <label for="email" class="form-label small fw-bold text-uppercase text-muted">Email Address</label>
                <input
                  type="email"
                  class="form-control theme-input bg-light"
                  id="email"
                  v-model="form.email"
                  disabled
                  readonly
                />
                <div class="form-text">Your email address cannot be changed.</div>
              </div>

              <div class="mb-3">
                <label for="name" class="form-label small fw-bold text-uppercase text-muted">Full Name</label>
                <input
                  type="text"
                  class="form-control theme-input"
                  id="name"
                  v-model="form.name"
                  placeholder="Enter your name"
                  required
                  :disabled="isLoading"
                />
                <div v-if="!form.name.trim()" class="text-danger small mt-1">
                  Name is required.
                </div>
              </div>

              <div class="mb-3">
                <label for="password" class="form-label small fw-bold text-uppercase text-muted">New Password</label>
                <div class="input-group-theme">
                  <input
                    :type="showPassword ? 'text' : 'password'"
                    class="form-control theme-input pe-5"
                    id="password"
                    v-model="form.password"
                    placeholder="Leave blank to keep current"
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
                <div class="form-text mt-2">
                  <span :class="{'text-success': form.password.length >= 8, 'text-muted': form.password.length === 0}">
                    <i class="bi" :class="form.password.length >= 8 ? 'bi-check-circle' : 'bi-circle'"></i> 8+ characters
                  </span>
                  <span class="ms-3" :class="{'text-success': /[A-Z]/.test(form.password), 'text-muted': form.password.length === 0}">
                    <i class="bi" :class="/[A-Z]/.test(form.password) ? 'bi-check-circle' : 'bi-circle'"></i> 1 Capital letter
                  </span>
                  <span class="ms-3" :class="{'text-success': /[^a-zA-Z0-9]/.test(form.password), 'text-muted': form.password.length === 0}">
                    <i class="bi" :class="/[^a-zA-Z0-9]/.test(form.password) ? 'bi-check-circle' : 'bi-circle'"></i> 1 Symbol
                  </span>
                </div>
              </div>

              <div class="mb-4">
                <label for="confirmPassword" class="form-label small fw-bold text-uppercase text-muted">Confirm New Password</label>
                <div class="input-group-theme">
                  <input
                    :type="showConfirmPassword ? 'text' : 'password'"
                    class="form-control theme-input pe-5"
                    id="confirmPassword"
                    v-model="form.confirmPassword"
                    placeholder="Repeat new password"
                    autocomplete="new-password"
                    :disabled="isLoading || !form.password"
                  />
                  <button 
                    type="button" 
                    class="btn btn-password-toggle"
                    @click="showConfirmPassword = !showConfirmPassword"
                    :disabled="!form.confirmPassword && !form.password"
                    tabindex="-1"
                  >
                    <i class="bi" :class="showConfirmPassword ? 'bi-eye-slash' : 'bi-eye'"></i>
                  </button>
                </div>
                <div v-if="isPasswordMismatch" class="text-danger small mt-2 d-flex align-items-center">
                  <i class="bi bi-x-circle me-1"></i> Passwords do not match
                </div>
              </div>

              <div class="d-grid gap-2 mt-4">
                <button 
                  type="submit" 
                  class="btn btn-theme-primary rounded-pill py-3 fw-bold" 
                  :disabled="!canSubmit"
                >
                  <span v-if="isLoading" class="spinner-border spinner-border-sm me-2"></span>
                  {{ isLoading ? 'Updating Profile...' : 'Save Changes' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back-link {
  transition: all 0.2s ease;
  opacity: 0.8;
  color: #64748b !important;
}

.back-link:hover {
  opacity: 1;
  color: var(--theme-yellow) !important;
  transform: translateX(-4px);
}

.theme-input {
  border-radius: 12px;
  padding: 12px 16px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.5);
  transition: all 0.2s ease;
}

.theme-input:focus {
  border-color: var(--theme-blue);
  box-shadow: 0 0 0 4px rgba(var(--theme-blue-rgb), 0.1);
  background: white;
}

.glass-modal {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

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

.btn-password-toggle:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
