import { ref } from 'vue'
import { defineStore } from 'pinia'

export type AccountSection = 'account' | 'general' | 'access'

export const useAccountPanelStore = defineStore('accountPanel', () => {
  const isOpen = ref(false)
  const activeSection = ref<AccountSection>('account')

  function open(section: AccountSection = 'account') {
    activeSection.value = section
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  return { isOpen, activeSection, open, close }
})
