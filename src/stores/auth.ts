import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { type WampSession } from '../services/wamp'
import { authService } from '../services/authService'
import { generateDeviceID, generateKeys } from '../utils/crypto'

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
    try {
      const { result, session: s } = await authService.register(form)
      console.dir(result)

      // Store session and username for verification step
      session.value = s
      pendingUsername.value = form.username
      localStorage.setItem('pending_verification_user', form.username)

      return result
    } catch (err) {
      session.value = null
      throw err
    }
  }

  async function verifyAccount(code: string) {
    const username = pendingUsername.value
    if (!username) {
      throw new Error('No pending registration found.')
    }

    let s = session.value

    // If no session, the service helper inside won't work exactly as the store did
    // because the store logic was "if !s, connect, then call, then close".
    // We will handle the connection logic here by checking session.value.

    let createdNewSession = false
    if (!s) {
      console.log('Restoring registrar session for verification...')
      s = await authService.getRegistrarSession()
      createdNewSession = true
    }

    try {
      // Direct call using the session
      const result = await s.call('io.xconn.deskconn.account.verify', [username, code])
      console.dir(result)

      // Verification successful
      pendingUsername.value = null
      localStorage.removeItem('pending_verification_user')

      return result
    } finally {
      if (s) {
        // If we created a temporary session, or if we want to clean up anyway:
        // The original logic closed it.
        await s.close().catch(console.error)
      }
      if (session.value === s || createdNewSession) {
        session.value = null
      }
    }
  }

  async function resendOtp() {
    const username = pendingUsername.value
    if (!username) {
      throw new Error('No pending registration found.')
    }

    try {
      const { result, session: s } = await authService.resendOtp(session.value, username)
      console.dir(result)

      // Update session if it was restored/created
      if (!session.value) {
        session.value = s
      }
      return result
    } catch (err) {
      throw err
    }
  }

  async function forgotPassword(email: string) {
    try {
      const { result, session: s, error } = await authService.forgotPassword(email)
      if (error) throw error

      session.value = s
      return result
    } catch (err) {
      session.value = null
      throw err
    }
  }

  async function resetPassword(email: string, password: string, otp: string) {
    const s = session.value
    try {
      const { result, session: newSession } = await authService.resetPassword(
        s,
        email,
        password,
        otp,
      )

      if (newSession) {
        await newSession.close().catch(console.error)
      }
      session.value = null
      return result
    } catch (err) {
      throw err
    }
  }

  async function loginAsGuest() {
    const timestamp = Date.now()
    const randomSuffix = Math.floor(Math.random() * 10000)
    const email = `guest_${timestamp}_${randomSuffix}@deskconn.local`
    // Ensure password meets complexity: 8+ chars, 1 Capital, 1 Symbol
    const password = `Guest_${timestamp}_${randomSuffix}!`
    const name = `Guest User ${randomSuffix}`

    try {
      const { session: regSession } = await authService.createGuestAccount(email, name, password)
      // Close the registration session as we need to login with new credentials
      if (regSession) {
        await regSession.close().catch(console.error)
      }

      // Perform login
      await login(email, password)
    } catch (err) {
      console.error('Guest login failed', err)
      throw err
    }
  }

  async function login(username: string, password: string) {
    // 1. Connect via CRA & Get Account
    const { session: s, userDetails } = await authService.login(username, password)
    session.value = s

    console.dir(userDetails)

    // 2. Device Check & Registration
    const userId = userDetails.id
    const storageKey = `device_credentials_${userId}`
    const storedCredsStr = localStorage.getItem(storageKey)

    if (!storedCredsStr) {
      console.log('Registering new device for user', userId)
      const deviceID = generateDeviceID()
      const { privateKey, publicKey } = await generateKeys()

      await authService.registerDevice(s, deviceID, publicKey)

      const creds = { deviceID, privateKey }
      localStorage.setItem(storageKey, JSON.stringify(creds))
    }

    // 3. Update State
    localStorage.setItem('last_active_user', userId)
    const userToSave = { ...userDetails, username }
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

    try {
      // Connect with stored credentials
      const { session: s, userDetails } = await authService.autoLogin(authId, privateKey)
      session.value = s

      console.dir(userDetails)
      // Update local user state in case details changed on server
      const userToSave = { ...userDetails, username: authId }
      setUser(userToSave)

      return true
    } catch (e) {
      console.error('Auto-login failed', e)
      return false
    }
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
    forgotPassword,
    resetPassword,
    loginAsGuest,
    logout,
  }
})
