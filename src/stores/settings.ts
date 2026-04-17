import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const useWebRTC = ref(localStorage.getItem('setting_use_webrtc') === 'true')

  function setUseWebRTC(value: boolean) {
    useWebRTC.value = value
    localStorage.setItem('setting_use_webrtc', String(value))
  }

  return { useWebRTC, setUseWebRTC }
})
