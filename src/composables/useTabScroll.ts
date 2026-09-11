import { ref } from 'vue'

/** Scroll-chevron + overflow tracking for a horizontally-scrolling tab strip —
 * shared by TerminalPanel's and TextEditor's titlebar tab bar so the two
 * don't drift out of sync (same math, same behavior). Each caller still
 * wires its own mount/resize/tab-count lifecycle around it. */
export function useTabScroll() {
  const tabsListRef = ref<HTMLDivElement | null>(null)
  const tabsScrollLeft = ref(0)
  const tabsScrollMax = ref(0)

  function updateTabsScroll() {
    const el = tabsListRef.value
    if (!el) return
    tabsScrollLeft.value = el.scrollLeft
    tabsScrollMax.value = Math.max(0, el.scrollWidth - el.clientWidth)
  }

  function scrollTabsBy(delta: number) {
    tabsListRef.value?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  function scrollTabsToEnd() {
    const el = tabsListRef.value
    if (!el) return
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
  }

  return { tabsListRef, tabsScrollLeft, tabsScrollMax, updateTabsScroll, scrollTabsBy, scrollTabsToEnd }
}
