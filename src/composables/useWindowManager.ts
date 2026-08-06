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
  /** Floor for interactive resizing — apps whose titlebar toolbar can't
   * compress past a certain width (e.g. Files) need a higher floor than the
   * generic default so their buttons don't overlap the window controls. */
  minWidth?: number
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
  minWidth?: number
}

export interface ContainerRect {
  x: number
  y: number
  width: number
  height: number
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

  function openWindow(options: OpenWindowOptions, container?: ContainerRect): string {
    const id = `win-${nextId++}`
    const offset = (cascadeIndex % CASCADE_LIMIT) * CASCADE_STEP
    cascadeIndex++

    const width = options.width ?? DEFAULT_WIDTH
    const height = options.height ?? DEFAULT_HEIGHT
    const originX = container?.x ?? 0
    const originY = container?.y ?? 0
    let x = originX + 24 + offset
    let y = originY + 24 + offset

    // Keep the cascade from placing a new window's bottom edge behind the
    // dock — container excludes the dock's thickness (see caller).
    if (container) {
      x = Math.max(originX, Math.min(x, originX + container.width - width))
      y = Math.max(originY, Math.min(y, originY + container.height - height))
    }

    const win: AppWindow = {
      id,
      appId: options.appId,
      title: options.title,
      icon: options.icon,
      iconColor: options.iconColor,
      iconBg: options.iconBg,
      x,
      y,
      width,
      height,
      minWidth: options.minWidth,
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

  function closeAll() {
    windows.value = []
    focusedId.value = null
  }

  function updateTitle(id: string, title: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.title = title
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

  function toggleMaximize(id: string, container: ContainerRect) {
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
      win.x = container.x
      win.y = container.y
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

  // Keeps maximized windows filling the container when it resizes (e.g. the
  // sidebar collapsing/expanding) — toggleMaximize only sizes them once, at the
  // moment they're maximized.
  function syncMaximizedBounds(container: ContainerRect) {
    for (const win of windows.value) {
      if (!win.maximized) continue
      win.x = container.x
      win.y = container.y
      win.width = container.width
      win.height = container.height
    }
  }

  return {
    windows,
    focusedId,
    openWindow,
    closeWindow,
    closeAll,
    focusWindow,
    minimizeWindow,
    restoreWindow,
    toggleMaximize,
    updateBounds,
    updateTitle,
    syncMaximizedBounds,
  }
}
