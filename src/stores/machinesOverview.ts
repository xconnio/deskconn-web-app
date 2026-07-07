import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useMachinesOverviewStore = defineStore('machinesOverview', () => {
  const isOpen = ref(false)

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  return { isOpen, open, close, toggle }
})
