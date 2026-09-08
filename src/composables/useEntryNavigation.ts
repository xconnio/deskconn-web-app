import { type Ref, nextTick } from 'vue'

/**
 * Reusable keyboard navigation for any entry list or grid.
 *
 * Handles ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Enter. `activeSelector`
 * (default `.entry-row.active`) is used to scroll the selected item into view
 * and focus it — point it at whatever selector marks the selected item in the
 * container.
 */
export function useEntryNavigation<T>(config: {
  entries: () => T[]
  getKey: (entry: T) => string
  selected: Ref<T | null>
  listRef: Ref<HTMLElement | null>
  isGrid: () => boolean
  onOpen: (entry: T) => void
  activeSelector?: string
}) {
  const { entries, getKey, selected, listRef, isGrid, onOpen, activeSelector = '.entry-row.active' } = config

  function columnCount(): number {
    if (!listRef.value) return 1
    return window.getComputedStyle(listRef.value).gridTemplateColumns.split(' ').length
  }

  function scrollActive(): void {
    nextTick(() => {
      const el = listRef.value?.querySelector<HTMLElement>(activeSelector)
      el?.scrollIntoView({ block: 'nearest' })
      // Otherwise the previously-clicked row keeps its native focus outline.
      el?.focus({ preventScroll: true })
    })
  }

  function moveTo(i: number): void {
    const list = entries()
    selected.value = list[Math.max(0, Math.min(i, list.length - 1))] ?? null
    scrollActive()
  }

  /**
   * Call from a keydown handler. Returns true if the key was consumed.
   */
  function handleNavKey(e: KeyboardEvent): boolean {
    const list = entries()
    if (!list.length) return false

    const idx = selected.value
      ? list.findIndex(x => getKey(x) === getKey(selected.value!))
      : -1
    const cols = isGrid() ? columnCount() : 1

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveTo(idx < 0 ? 0 : idx + cols)
        return true
      case 'ArrowUp':
        e.preventDefault()
        moveTo(idx < 0 ? list.length - 1 : idx - cols)
        return true
      case 'ArrowRight':
        e.preventDefault()
        if (isGrid()) moveTo(idx < 0 ? 0 : idx + 1)
        else if (selected.value) onOpen(selected.value)
        return true
      case 'ArrowLeft':
        e.preventDefault()
        if (isGrid()) moveTo(Math.max(0, idx - 1))
        return true
      case 'Enter':
        if (selected.value) { e.preventDefault(); onOpen(selected.value) }
        return true
    }
    return false
  }

  return { handleNavKey }
}
