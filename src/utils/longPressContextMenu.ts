// iOS/iPadOS Safari never fires `contextmenu` on a long-press, which leaves
// every right-click-only menu unreachable there. Synthesize one. Other touch
// browsers (Android, ChromeOS) already fire their own, so this is iOS-only.
const LONG_PRESS_MS = 600
const MOVE_TOLERANCE = 10

export function installLongPressContextMenu() {
  const isIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports a desktop Mac user agent.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIOS) return

  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false
  let startX = 0
  let startY = 0

  window.addEventListener('touchstart', (e) => {
    clearTimeout(timer)
    fired = false
    const touch = e.touches[0]
    const target = e.target as Element | null
    // The terminal runs its own long-press text selection.
    if (e.touches.length !== 1 || !touch || !target || target.closest('.xterm')) return
    startX = touch.clientX
    startY = touch.clientY
    timer = setTimeout(() => {
      fired = true
      target.dispatchEvent(new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: startX,
        clientY: startY,
        button: 2,
        pointerType: 'touch',
      }))
    }, LONG_PRESS_MS)
  }, { capture: true, passive: true })

  window.addEventListener('touchmove', (e) => {
    const touch = e.touches[0]
    if (!touch || Math.hypot(touch.clientX - startX, touch.clientY - startY) > MOVE_TOLERANCE) clearTimeout(timer)
  }, { capture: true, passive: true })

  window.addEventListener('touchend', (e) => {
    clearTimeout(timer)
    // Swallow the click that lifting the finger would send, or it would
    // immediately dismiss the menu that just opened.
    if (fired && e.cancelable) e.preventDefault()
  }, { capture: true })

  window.addEventListener('touchcancel', () => clearTimeout(timer), { capture: true })
}
