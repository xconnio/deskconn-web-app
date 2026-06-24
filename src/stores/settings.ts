import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', () => {
  const useWebRTC = ref(localStorage.getItem('setting_use_webrtc') === 'true')
  const singleClickOpen = ref(localStorage.getItem('setting_single_click_open') === 'true')
  const useRemoteWallpaper = ref(localStorage.getItem('setting_use_remote_wallpaper') !== 'false')
  const resourceMonitorInterval = ref(
    parseInt(localStorage.getItem('setting_resource_monitor_interval') ?? '1', 10),
  )

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

  function setResourceMonitorInterval(value: number) {
    resourceMonitorInterval.value = value
    localStorage.setItem('setting_resource_monitor_interval', String(value))
  }

  return {
    useWebRTC, setUseWebRTC,
    singleClickOpen, setSingleClickOpen,
    useRemoteWallpaper, setUseRemoteWallpaper,
    resourceMonitorInterval, setResourceMonitorInterval,
  }
})
