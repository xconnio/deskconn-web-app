import router from './index'

export function openFiles(realm: string, desktopName?: string, initialPath?: string) {
  router.push({
    name: 'desktop-files',
    params: { realm },
    query: {
      ...(desktopName  ? { name: desktopName }      : {}),
      ...(initialPath  ? { path: initialPath }       : {}),
    },
  })
}

export function openLauncher(realm: string, desktopName?: string, notSupported?: string) {
  router.push({
    name: 'desktop-launcher',
    params: { realm },
    query: {
      ...(desktopName  ? { name: desktopName } : {}),
      ...(notSupported ? { notSupported }      : {}),
    },
  })
}

export function openIndexedFiles(realm: string, category: string, desktopName?: string) {
  router.push({
    name: 'desktop-index',
    params: { realm, category },
    query: desktopName ? { name: desktopName } : {},
  })
}
