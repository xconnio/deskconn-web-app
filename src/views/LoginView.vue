<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Modal } from 'bootstrap'
import { useAuthStore } from '../stores/auth'
import { connectCRA } from 'xconn'
import { generateDeviceID, generateKeys } from '../utils/crypto'
import { WAMP_URL, WAMP_REALM } from '../config'

const router = useRouter()
const authStore = useAuthStore()
const loginSuccessModal = ref<HTMLElement | null>(null)
let modalInstance: Modal | null = null
// Keeping session in a ref for now as requested to keep it open
const session = ref<unknown>(null)

const form = ref({
  username: '',
  password: '',
})

const error = ref('')

onMounted(() => {
  if (loginSuccessModal.value) {
    modalInstance = new Modal(loginSuccessModal.value)
    // Optional: Redirect when modal is closed via keyboard or backdrop
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

    const s = await connectCRA(WAMP_URL, WAMP_REALM, form.value.username, form.value.password)

    session.value = s
    // Call account.get. Assuming it takes username as arg or implicit.
    // Based on "call the procedure to get user", providing username is safest bet for a 'get' call
    // if we haven't seen the signature, but typically 'get' on a session might return 'me'.
    // Given the previous pattern, I'll try passing the username.
    // WAMP result structure: { args: [userObject], kwargs: ... }
    const result = await s.call('io.xconn.deskconn.account.get')
    console.dir(result)

    // Verify result structure and extract user
    const userDetails = result.args?.[0] || result

    if (!userDetails || !userDetails.id) {
      throw new Error('Invalid user details received')
    }

    const userId = userDetails.id
    const storageKey = `device_credentials_${userId}`

    // Check if we already have a device registered for this user
    const storedCreds = localStorage.getItem(storageKey)

    if (!storedCreds) {
      // Register New Device
      const deviceID = generateDeviceID()
      const { privateKey, publicKey } = await generateKeys()

      // Pass kwargs as 3rd argument
      await s.call('io.xconn.deskconn.device.create', [deviceID, publicKey], {
        name: 'Browser Interface',
      })

      const creds = { deviceID, privateKey }
      localStorage.setItem(storageKey, JSON.stringify(creds))
    }

    // Mark who is logged in for auto-login
    localStorage.setItem('last_active_user', userId)

    // Ensure username is preserved in the store
    const userToSave = { ...userDetails, username: form.value.username }

    // Update store and redirect
    authStore.login(userToSave)
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
          <button type="button" class="btn btn-primary" @click="handleSuccessConfirm">Okay</button>
        </div>
      </div>
    </div>
  </div>
</template>
