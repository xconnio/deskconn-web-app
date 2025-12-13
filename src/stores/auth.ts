import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { wampService, type WampSession } from '../services/wamp'
import { generateDeviceID, generateKeys } from '../utils/crypto'
import { REGISTRATION_AUTHID, REGISTRATION_SECRET } from '../config'

export interface User {
  id: string
  username: string
  name?: string
  email?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export const useAuthStore = defineStore('auth', () => {
  // State

  const user = ref<User | null>(JSON.parse(localStorage.getItem('currentUser') || 'null'))
  const session = ref<WampSession | null>(null)
  const pendingUsername = ref<string | null>(localStorage.getItem('pending_verification_user'))

  // Getters
  const isAuthenticated = computed(() => !!user.value)

  // Helper: Persist user state
  function setUser(userData: User | null) {
    user.value = userData
    if (userData) {
      localStorage.setItem('currentUser', JSON.stringify(userData))
    } else {
      localStorage.removeItem('currentUser')
    }
  }

  // Actions
  async function register(form: { username: string; name: string; password: string }) {
    // Connect with registrar credentials
    const s = await wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)

    try {
      const result = await s.call('io.xconn.deskconn.account.create', [
        form.username,
        form.name,
        'user',
        form.password,
      ])
      console.dir(result)

      // Store session and username for verification step
      session.value = s
      pendingUsername.value = form.username
      localStorage.setItem('pending_verification_user', form.username)

      return result
    } catch (err) {
      // Close session on failure
      session.value = null
      await s.close().catch(console.error)
      throw err
    }
  }

  async function verifyAccount(code: string) {
    const username = pendingUsername.value
    if (!username) {
      throw new Error('No pending registration found.')
    }

    // Ensure we have a valid registrar session
    let s = session.value

    if (!s) {
      console.log('Restoring registrar session for verification...')
      s = await wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)
    }

    try {
      const result = await s.call('io.xconn.deskconn.account.verify', [username, code])
      console.dir(result)

      // Verification successful
      // Clear pending state
      pendingUsername.value = null
      localStorage.removeItem('pending_verification_user')

      return result
    } finally {
      // Close the registrar session
      if (s) {
        await s.close().catch(console.error)
      }
      if (session.value === s) {
        session.value = null
      }
    }
  }

  async function resendOtp() {
    const username = pendingUsername.value
    if (!username) {
      throw new Error('No pending registration found.')
    }

    let s = session.value
    if (!s) {
      console.log('Restoring registrar session for resend OTP...')
      s = await wampService.connectWithCryptosign(REGISTRATION_AUTHID, REGISTRATION_SECRET)
    }

    try {
      const result = await s.call('io.xconn.deskconn.account.otp.resend', [username])
      console.dir(result)
      return result
    } finally {
      // We keep the session open for the verification input that follows?
      // Actually verifyAccount creates a session if needed.
      // Reuse logic: if we created a new session just for this call, we might want to close it or keep it for verify.
      // Since user will verify right after, putting it in session.value is good.
      if (!session.value) {
        session.value = s
      }
    }
  }

  async function login(username: string, password: string) {
    // 1. Connect via CRA
    const s = await wampService.connectWithCRA(username, password)
    session.value = s

    // 2. Get Account Details
    const result = await s.call('io.xconn.deskconn.account.get')
    console.dir(result)

    // Verify result structure and extract user
    const userDetails = result.args?.[0] || result

    if (!userDetails || !userDetails.id) {
      throw new Error('Invalid user details received')
    }

    // 3. Device Check & Registration
    const userId = userDetails.id
    const storageKey = `device_credentials_${userId}`
    const storedCredsStr = localStorage.getItem(storageKey)

    if (!storedCredsStr) {
      console.log('Registering new device for user', userId)
      const deviceID = generateDeviceID()
      const { privateKey, publicKey } = await generateKeys()

      await s.call('io.xconn.deskconn.device.create', [deviceID, publicKey], {
        name: 'Browser Interface',
      })

      const creds = { deviceID, privateKey }
      localStorage.setItem(storageKey, JSON.stringify(creds))
    }

    // 4. Update State
    localStorage.setItem('last_active_user', userId)
    const userToSave = { ...userDetails, username } // Ensure username is preserved
    setUser(userToSave)
  }

  async function autoLogin() {
    const lastUserId = localStorage.getItem('last_active_user')
    const storedUserStr = localStorage.getItem('currentUser')

    if (!lastUserId || !storedUserStr) return false

    const storageKey = `device_credentials_${lastUserId}`
    const storedCredsStr = localStorage.getItem(storageKey)
    const storedUser = JSON.parse(storedUserStr)
    const authId = storedUser.username || storedUser.email

    if (!storedCredsStr || !authId) return false

    const { privateKey } = JSON.parse(storedCredsStr)

    // Connect with stored credentials
    const s = await wampService.connectWithCryptosign(authId, privateKey)
    session.value = s

    // Fetch fresh details
    const result = await s.call('io.xconn.deskconn.account.get')
    const userDetails = result.args?.[0] || result

    console.dir(userDetails)
    // Update local user state in case details changed on server
    const userToSave = { ...userDetails, username: authId }
    setUser(userToSave)

    return true
  }

  function logout() {
    session.value?.close().catch(console.error)
    session.value = null
    setUser(null)
    localStorage.removeItem('last_active_user')
  }

  return {
    user,
    isAuthenticated,
    pendingUsername,
    session,
    login,
    register,
    verifyAccount,
    resendOtp,
    autoLogin,
    logout,
  }
})
