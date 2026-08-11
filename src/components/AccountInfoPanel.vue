<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const successMessage = ref('')
const errorMessage = ref('')

function flashSuccess(msg: string) {
  successMessage.value = msg
  setTimeout(() => {
    successMessage.value = ''
  }, 3000)
}

// --- Full Name (changeable) ---
const editingName = ref(false)
const nameDraft = ref('')
const savingName = ref(false)

function startEditName() {
  nameDraft.value = authStore.user?.name ?? ''
  editingName.value = true
  errorMessage.value = ''
}

async function saveName() {
  if (!nameDraft.value.trim()) return
  savingName.value = true
  errorMessage.value = ''
  try {
    await authStore.updateProfile(nameDraft.value.trim())
    editingName.value = false
    flashSuccess('Name updated successfully!')
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to update name'
  } finally {
    savingName.value = false
  }
}

// --- Password (changeable) ---
const editingPassword = ref(false)
const password = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)

function validatePassword(pw: string) {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[^a-zA-Z0-9]/.test(pw)
}

const isPasswordMismatch = computed(() => password.value !== '' && password.value !== confirmPassword.value)
const canSavePassword = computed(
  () => validatePassword(password.value) && !isPasswordMismatch.value && !savingPassword.value,
)

function startEditPassword() {
  password.value = ''
  confirmPassword.value = ''
  editingPassword.value = true
  errorMessage.value = ''
}

async function savePassword() {
  if (!canSavePassword.value) return
  savingPassword.value = true
  errorMessage.value = ''
  try {
    await authStore.updateProfile(authStore.user?.name ?? '', password.value)
    editingPassword.value = false
    flashSuccess('Password updated successfully!')
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to update password'
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <div class="container py-0">
    <div class="row justify-content-center">
      <div class="col-lg-10">
        <div v-if="successMessage" class="alert alert-success d-flex align-items-center mb-3 border-0 shadow-sm">
          <i class="bi bi-check-circle-fill me-2"></i>{{ successMessage }}
        </div>
        <div v-if="errorMessage" class="alert alert-danger d-flex align-items-center mb-3 border-0 shadow-sm">
          <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ errorMessage }}
        </div>

        <h6 class="discord-group-heading">Account Info</h6>

        <!-- Email: not changeable -->
        <div class="discord-row">
          <div class="min-w-0">
            <div class="discord-row-label">Email</div>
            <div class="discord-row-value text-truncate">{{ authStore.user?.email }}</div>
          </div>
        </div>

        <!-- Full Name: changeable -->
        <div class="discord-row">
          <div class="flex-grow-1 min-w-0">
            <div class="discord-row-label">Full Name</div>
            <div v-if="!editingName" class="discord-row-value text-truncate">{{ authStore.user?.name }}</div>
            <div v-else class="d-flex align-items-center gap-2 mt-1">
              <input
                v-model="nameDraft"
                type="text"
                class="form-control form-control-sm account-info-input"
                :disabled="savingName"
                @keyup.enter="saveName"
              />
              <button
                class="btn btn-theme-primary btn-compact rounded-pill"
                :disabled="!nameDraft.trim() || savingName"
                @click="saveName"
              >
                Save
              </button>
              <button class="btn btn-outline-secondary btn-compact rounded-pill" :disabled="savingName" @click="editingName = false">
                Cancel
              </button>
            </div>
          </div>
          <button
            v-if="!editingName"
            class="btn btn-outline-secondary btn-compact rounded-pill flex-shrink-0"
            @click="startEditName"
          >
            Edit
          </button>
        </div>

        <hr class="discord-group-divider" />

        <h6 class="discord-group-heading">Password &amp; Security</h6>

        <!-- Password: changeable -->
        <div class="discord-row align-items-start">
          <div class="flex-grow-1 min-w-0">
            <div class="discord-row-label">Password</div>
            <div v-if="!editingPassword" class="discord-row-value">••••••••</div>

            <div v-else class="mt-2">
              <div class="mb-2">
                <input
                  v-model="password"
                  type="password"
                  class="form-control account-info-input"
                  placeholder="New password"
                  autocomplete="new-password"
                  :disabled="savingPassword"
                />
              </div>
              <div class="password-hints mb-2">
                <span :class="{ 'text-success': password.length >= 8, 'text-muted': password.length === 0 }">
                  <i class="bi" :class="password.length >= 8 ? 'bi-check-circle' : 'bi-circle'"></i> 8+ characters
                </span>
                <span :class="{ 'text-success': /[A-Z]/.test(password), 'text-muted': password.length === 0 }">
                  <i class="bi" :class="/[A-Z]/.test(password) ? 'bi-check-circle' : 'bi-circle'"></i> 1 Capital letter
                </span>
                <span :class="{ 'text-success': /[^a-zA-Z0-9]/.test(password), 'text-muted': password.length === 0 }">
                  <i class="bi" :class="/[^a-zA-Z0-9]/.test(password) ? 'bi-check-circle' : 'bi-circle'"></i> 1 Symbol
                </span>
              </div>
              <div class="mb-2">
                <input
                  v-model="confirmPassword"
                  type="password"
                  class="form-control account-info-input"
                  placeholder="Confirm new password"
                  autocomplete="new-password"
                  :disabled="savingPassword"
                  @keyup.enter="savePassword"
                />
              </div>
              <div v-if="isPasswordMismatch" class="text-danger small mb-2">
                <i class="bi bi-x-circle me-1"></i>Passwords do not match
              </div>
              <button class="btn btn-theme-primary btn-compact rounded-pill" :disabled="!canSavePassword" @click="savePassword">
                Save Password
              </button>
            </div>
          </div>
          <button
            v-if="!editingPassword"
            class="btn btn-outline-secondary btn-compact rounded-pill flex-shrink-0"
            @click="startEditPassword"
          >
            Edit
          </button>
          <button v-else class="btn btn-outline-secondary btn-compact rounded-pill flex-shrink-0" @click="editingPassword = false">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-info-input {
  max-width: 260px;
}

.password-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  font-size: 0.8rem;
}
</style>
