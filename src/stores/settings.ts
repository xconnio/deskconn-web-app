import { ref } from 'vue'
import { defineStore } from 'pinia'

export type DockPosition = 'bottom' | 'left' | 'right'

const VALID_DOCK_POSITIONS: DockPosition[] = ['bottom', 'left', 'right']

function readDockPosition(realm: string): DockPosition {
  const stored = localStorage.getItem(`setting_dock_position_${realm}`)
  return VALID_DOCK_POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : 'left'
}

export const useSettingsStore = defineStore('settings', () => {
  const useWebRTC = ref(localStorage.getItem('setting_use_webrtc') === 'true')
  const singleClickOpen = ref(localStorage.getItem('setting_single_click_open') === 'true')
  const useRemoteWallpaper = ref(localStorage.getItem('setting_use_remote_wallpaper') !== 'false')
  const resourceMonitorInterval = ref(
    parseInt(localStorage.getItem('setting_resource_monitor_interval') ?? '1', 10),
  )
  // Dock position is per-machine — set via the "Settings" app inside each
  // machine's dock, not a global account preference — so it's keyed by realm
  // and hydrated lazily rather than loaded all at once.
  const dockPositions = ref<Record<string, DockPosition>>({})

  function getDockPosition(realm: string): DockPosition {
    if (!(realm in dockPositions.value)) {
      dockPositions.value[realm] = readDockPosition(realm)
    }
    return dockPositions.value[realm]!
  }

  function setDockPosition(realm: string, value: DockPosition) {
    dockPositions.value[realm] = value
    localStorage.setItem(`setting_dock_position_${realm}`, value)
  }

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
    getDockPosition, setDockPosition,
  }
})
