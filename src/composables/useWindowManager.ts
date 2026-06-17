import { ref } from 'vue'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppWindow {
  id: string
  appId: string
  title: string
  icon: string
  iconColor: string
  iconBg: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  prevBounds?: WindowBounds
  props: Record<string, unknown>
}

export interface OpenWindowOptions {
  appId: string
  title: string
  icon: string
  iconColor: string
  iconBg: string
  props?: Record<string, unknown>
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 480
const CASCADE_STEP = 28
const CASCADE_LIMIT = 8

export function useWindowManager() {
  const windows = ref<AppWindow[]>([])
  const focusedId = ref<string | null>(null)
  let nextZ = 1
  let nextId = 1
  let cascadeIndex = 0

  function focusWindow(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.zIndex = ++nextZ
    focusedId.value = id
  }

  function refocusTopWindow() {
    let top: AppWindow | null = null
    for (const w of windows.value) {
      if (w.minimized) continue
      if (!top || w.zIndex > top.zIndex) top = w
    }
    focusedId.value = top?.id ?? null
  }

  function openWindow(options: OpenWindowOptions): string {
    const id = `win-${nextId++}`
    const offset = (cascadeIndex % CASCADE_LIMIT) * CASCADE_STEP
    cascadeIndex++

    const win: AppWindow = {
      id,
      appId: options.appId,
      title: options.title,
      icon: options.icon,
      iconColor: options.iconColor,
      iconBg: options.iconBg,
      x: 24 + offset,
      y: 24 + offset,
      width: options.width ?? DEFAULT_WIDTH,
      height: options.height ?? DEFAULT_HEIGHT,
      zIndex: ++nextZ,
      minimized: false,
      maximized: false,
      props: options.props ?? {},
    }

    windows.value.push(win)
    focusedId.value = id
    return id
  }

  function closeWindow(id: string) {
    windows.value = windows.value.filter((w) => w.id !== id)
    if (focusedId.value === id) refocusTopWindow()
  }

  function minimizeWindow(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.minimized = true
    if (focusedId.value === id) refocusTopWindow()
  }

  function restoreWindow(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.minimized = false
    focusWindow(id)
  }

  function toggleMaximize(id: string, container: { width: number; height: number }) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return

    if (win.maximized) {
      if (win.prevBounds) {
        win.x = win.prevBounds.x
        win.y = win.prevBounds.y
        win.width = win.prevBounds.width
        win.height = win.prevBounds.height
      }
      win.maximized = false
      win.prevBounds = undefined
    } else {
      win.prevBounds = { x: win.x, y: win.y, width: win.width, height: win.height }
      win.x = 0
      win.y = 0
      win.width = container.width
      win.height = container.height
      win.maximized = true
    }
    focusWindow(id)
  }

  function updateBounds(id: string, bounds: Partial<WindowBounds>) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    if (win.maximized) return
    Object.assign(win, bounds)
  }

  return {
    windows,
    focusedId,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    restoreWindow,
    toggleMaximize,
    updateBounds,
  }
}
