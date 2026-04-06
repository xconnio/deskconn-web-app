import router from './index'

export function openDesktop(realm: string) {
  openDesktopWindow(`/desktops/${realm}`)
}

export function openFileExplorer(realm: string, desktopName?: string) {
  router.push({
    name: 'desktop-files',
    params: { realm },
    query: desktopName ? { name: desktopName } : {},
  })
}

function openDesktopWindow(path: string) {
  const url = router.resolve(path).href

  const width = 1000
  const height = 700

  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  window.open(
    url,
    '_blank',
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  )
}
