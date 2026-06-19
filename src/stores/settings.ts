import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const useWebRTC = ref(localStorage.getItem('setting_use_webrtc') === 'true')
  const singleClickOpen = ref(localStorage.getItem('setting_single_click_open') === 'true')
  const useRemoteWallpaper = ref(localStorage.getItem('setting_use_remote_wallpaper') !== 'false')

  function setUseWebRTC(value: boolean) {
    useWebRTC.value = value
    localStorage.setItem('setting_use_webrtc', String(value))
  }

  function setSingleClickOpen(value: boolean) {
    singleClickOpen.value = value
    localStorage.setItem('setting_single_click_open', String(value))
  }

  function setUseRemoteWallpaper(value: boolean) {
    useRemoteWallpaper.value = value
    localStorage.setItem('setting_use_remote_wallpaper', String(value))
  }

  return { useWebRTC, setUseWebRTC, singleClickOpen, setSingleClickOpen, useRemoteWallpaper, setUseRemoteWallpaper }
})
