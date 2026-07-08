import type { InjectionKey, Ref } from 'vue'

/** Teleport target for an embedded app's own titlebar toolbar (see FloatingWindow.vue). */
export const floatingWindowToolbarKey: InjectionKey<Ref<HTMLElement | null>> = Symbol('floatingWindowToolbarHost')
