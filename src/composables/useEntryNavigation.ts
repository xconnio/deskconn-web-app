import { type Ref, nextTick } from 'vue'

interface HasPath { path: string }

/**
 * Reusable keyboard navigation for any entry list or grid.
 *
 * Handles ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Enter.
 * Expects the container element to use `.entry-row` for items and
 * `.entry-row.active` for the currently selected row (for scroll-into-view).
 */
export function useEntryNavigation<T extends HasPath>(config: {
  entries: () => T[]
  selected: Ref<T | null>
  listRef: Ref<HTMLElement | null>
  isGrid: () => boolean
  onOpen: (entry: T) => void
}) {
  const { entries, selected, listRef, isGrid, onOpen } = config

  function columnCount(): number {
    if (!listRef.value) return 1
    return window.getComputedStyle(listRef.value).gridTemplateColumns.split(' ').length
  }

  function scrollActive(): void {
    nextTick(() => {
      listRef.value
        ?.querySelector<HTMLElement>('.entry-row.active')
        ?.scrollIntoView({ block: 'nearest' })
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
      ? list.findIndex(x => x.path === selected.value!.path)
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
