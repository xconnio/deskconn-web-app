import router from './index'

export function openFileExplorer(realm: string, desktopName?: string) {
  router.push({
    name: 'desktop-files',
    params: { realm },
    query: desktopName ? { name: desktopName } : {},
  })
}

export function openLauncher(realm: string, desktopName?: string) {
  router.push({
    name: 'desktop-launcher',
    params: { realm },
    query: desktopName ? { name: desktopName } : {},
  })
}
