import { ref } from 'vue'
import { defineStore } from 'pinia'

export type DockPosition = 'bottom' | 'left' | 'right'

const VALID_DOCK_POSITIONS: DockPosition[] = ['bottom', 'left', 'right']

function readDockPosition(realm: string): DockPosition {
  const stored = localStorage.getItem(`setting_dock_position_${realm}`)
  return VALID_DOCK_POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : 'left'
}

function readResourceMonitorInterval(realm: string): number {
  return parseInt(localStorage.getItem(`setting_resource_monitor_interval_${realm}`) ?? '1', 10)
}

export const useSettingsStore = defineStore('settings', () => {
  const lastRealm = ref(localStorage.getItem('setting_last_realm'))
  const useWebRTC = ref(localStorage.getItem('setting_use_webrtc') === 'true')
  const singleClickOpen = ref(localStorage.getItem('setting_single_click_open') === 'true')
  const useRemoteWallpaper = ref(localStorage.getItem('setting_use_remote_wallpaper') !== 'false')
  const showLogicalCpus = ref(localStorage.getItem('setting_show_logical_cpus') === 'true')
  // Dock position and resource monitor refresh interval are per-machine —
  // set via the "Settings" app inside each machine's dock, not a global
  // account preference — so they're keyed by realm and hydrated lazily
  // rather than loaded all at once.
  const dockPositions = ref<Record<string, DockPosition>>({})
  const resourceMonitorIntervals = ref<Record<string, number>>({})

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

  function getResourceMonitorInterval(realm: string): number {
    if (!(realm in resourceMonitorIntervals.value)) {
      resourceMonitorIntervals.value[realm] = readResourceMonitorInterval(realm)
    }
    return resourceMonitorIntervals.value[realm]!
  }

  function setResourceMonitorInterval(realm: string, value: number) {
    resourceMonitorIntervals.value[realm] = value
    localStorage.setItem(`setting_resource_monitor_interval_${realm}`, String(value))
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

  function setShowLogicalCpus(value: boolean) {
    showLogicalCpus.value = value
    localStorage.setItem('setting_show_logical_cpus', String(value))
  }

  function setLastRealm(realm: string) {
    lastRealm.value = realm
    localStorage.setItem('setting_last_realm', realm)
  }

  // Clears which machine to land on next — used when the user explicitly
  // navigates to the Machines picker, so reopening the app later (even in a
  // fresh browser session) lands back on the picker instead of jumping
  // straight into whatever machine was open before.
  function clearLastRealm() {
    lastRealm.value = null
    localStorage.removeItem('setting_last_realm')
  }

  return {
    lastRealm, setLastRealm, clearLastRealm,
    useWebRTC, setUseWebRTC,
    singleClickOpen, setSingleClickOpen,
    useRemoteWallpaper, setUseRemoteWallpaper,
    showLogicalCpus, setShowLogicalCpus,
    getDockPosition, setDockPosition,
    getResourceMonitorInterval, setResourceMonitorInterval,
  }
})
