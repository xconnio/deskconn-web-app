import type { InjectionKey, Ref } from 'vue'

/** Teleport target for an embedded app's own titlebar toolbar (see FloatingWindow.vue). */
export const floatingWindowToolbarKey: InjectionKey<Ref<HTMLElement | null>> = Symbol('floatingWindowToolbarHost')

/** Teleport target for a small set of action buttons shown beside the window controls
 * (minimize/maximize/close), independent of the full toolbar titlebar above. */
export const floatingWindowActionsKey: InjectionKey<Ref<HTMLElement | null>> = Symbol('floatingWindowActionsHost')
