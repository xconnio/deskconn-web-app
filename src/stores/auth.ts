import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', () => {
  // Initialize user from localStorage if available
  const user = ref(JSON.parse(localStorage.getItem('currentUser') || 'null'))

  const isAuthenticated = computed(() => !!user.value)

  function login(userData: { name: string; username: string }) {
    user.value = userData
    localStorage.setItem('currentUser', JSON.stringify(userData))
  }

  function logout() {
    user.value = null
    localStorage.removeItem('currentUser')
  }

  return { user, isAuthenticated, login, logout }
})
