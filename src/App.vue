<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, defineAsyncComponent } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { useAuthStore } from './stores/auth'
import { useMachinesStore } from './stores/machines'
import { useDesktopSessionsStore } from './stores/desktopSessions'
import { useSessionCacheStore } from './stores/sessionCache'
import { useAccountPanelStore } from './stores/accountPanel'
import AccountPanel from './components/AccountPanel.vue'

const DesktopSessionHost = defineAsyncComponent(() => import('./components/DesktopSessionHost.vue'))

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const machinesStore = useMachinesStore()
const desktopSessionsStore = useDesktopSessionsStore()
const sessionCacheStore = useSessionCacheStore()
const accountPanelStore = useAccountPanelStore()

const activeRealm = computed(() =>
  route.name === 'desktop-launcher' ? (route.params.realm as string) : null,
)

const renderedRealms = computed(() => {
  const set = new Set(desktopSessionsStore.knownRealms)
  if (activeRealm.value) set.add(activeRealm.value)
  return [...set].filter(
    (r) => r === activeRealm.value || desktopSessionsStore.hasOpenWindows(r),
  )
})

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (!desktopSessionsStore.anyOpenWindowsAnywhere() && !sessionCacheStore.isAnyActive()) return
  e.preventDefault()
}

const sidebarCollapsed = ref(false)
const mobileOpen = ref(false)

const isDesktopView = computed(() => route.name === 'desktop-launcher')
const hasDarkBackground = computed(() => isDesktopView.value || route.name === 'home')
const showSidebar = computed(
  () => !route.meta.hideNavbar && authStore.isAuthenticated && !isDesktopView.value,
)

const toggleSidebar = () => {
  if (window.innerWidth < 768) {
    mobileOpen.value = false
  } else {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }
}

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}

const isMachinesRoute = () =>
  route.path === '/' ||
  route.name === 'desktop-launcher' ||
  route.name === 'desktop-files' ||
  route.name === 'desktop-index'

// Close mobile sidebar on route change
watch(() => route.fullPath, () => {
  mobileOpen.value = false
})

// Resets the tab title when leaving all desktop sessions (DesktopSessionHost sets it while active).
watch(activeRealm, (realm) => {
  if (!realm) document.title = 'Deskconn'
})

watch(
  () => authStore.session,
  (session) => {
    if (session) {
      machinesStore.fetchMachines(session)
      return
    }

    machinesStore.clearMachines()
  },
  { immediate: true },
)

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)

  try {
    const success = await authStore.autoLogin()
    if (success) {
      if (
        router.currentRoute.value.path === '/login' ||
        router.currentRoute.value.path === '/register'
      ) {
        router.push('/')
      }
    }
  } catch (err) {
    console.error('Auto-login failed', err)
    authStore.logout()
    if (router.currentRoute.value.path !== '/login') {
      router.push('/login')
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <div class="app-wrapper">

    <!-- Mobile top bar -->
    <header
      v-if="showSidebar"
      class="mobile-topbar"
    >
      <button class="mobile-menu-btn" @click="mobileOpen = true">
        <i class="bi bi-list"></i>
      </button>
      <span class="mobile-brand">Deskconn</span>
    </header>

    <!-- Backdrop (mobile only) -->
    <div
      v-if="showSidebar && mobileOpen"
      class="sidebar-backdrop"
      @click="mobileOpen = false"
    />

    <!-- Sidebar -->
    <aside
      v-if="showSidebar"
      class="sidebar"
      :class="{ 'sidebar-collapsed': sidebarCollapsed, 'mobile-open': mobileOpen }"
    >
      <!-- Header: brand + toggle -->
      <div class="sidebar-header" :class="{ 'sidebar-header-collapsed': sidebarCollapsed }">
        <span v-if="!sidebarCollapsed" class="sidebar-brand">Deskconn</span>
        <button
          class="sidebar-toggle"
          @click="toggleSidebar"
          :title="mobileOpen ? 'Close' : sidebarCollapsed ? 'Expand' : 'Collapse'"
        >
          <i class="bi" :class="mobileOpen ? 'bi-x-lg' : sidebarCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'"></i>
        </button>
      </div>

      <!-- Navigation items -->
      <nav class="sidebar-nav">
        <router-link
          to="/"
          class="sidebar-item"
          :class="{ active: isMachinesRoute() }"
          :title="sidebarCollapsed ? 'Machines' : ''"
        >
          <i class="bi bi-pc-display"></i>
          <span v-if="!sidebarCollapsed">Machines</span>
        </router-link>
      </nav>

      <!-- Footer: settings link + profile link + logout -->
      <div class="sidebar-footer">
        <button
          class="sidebar-item"
          :class="{ active: accountPanelStore.isOpen }"
          :title="sidebarCollapsed ? 'Settings' : ''"
          @click="accountPanelStore.open('general')"
        >
          <i class="bi bi-gear"></i>
          <span v-if="!sidebarCollapsed">Settings</span>
        </button>

        <button
          class="sidebar-item sidebar-user"
          :class="{ active: accountPanelStore.isOpen }"
          :title="sidebarCollapsed ? 'Profile' : ''"
          @click="accountPanelStore.open('account')"
        >
          <i class="bi bi-person-circle"></i>
          <span v-if="!sidebarCollapsed" class="sidebar-user-label">
            Hello, {{ authStore.user?.name || authStore.user?.email }}
          </span>
        </button>

        <button
          class="sidebar-item sidebar-logout"
          @click="handleLogout"
          :title="sidebarCollapsed ? 'Logout' : ''"
        >
          <i class="bi bi-box-arrow-right"></i>
          <span v-if="!sidebarCollapsed">Logout</span>
        </button>
      </div>
    </aside>

    <!-- Main content -->
    <main
      class="main-content"
      :class="{ 'has-topbar': showSidebar, 'is-desktop': hasDarkBackground }"
    >
      <RouterView />
      <DesktopSessionHost
        v-for="r in renderedRealms"
        :key="r"
        :realm="r"
        :active="r === activeRealm"
        v-show="r === activeRealm"
      />
    </main>

    <AccountPanel v-if="authStore.isAuthenticated" />

  </div>
</template>

<style>
.app-wrapper {
  display: flex;
  min-height: 100vh;
}

/* ── Mobile top bar ── */
.mobile-topbar {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  background: #ffffff;
  border-bottom: 1px solid #e8ecf0;
  align-items: center;
  padding: 0 1rem;
  gap: 0.75rem;
  z-index: 1030;
}

.mobile-menu-btn {
  background: none;
  border: none;
  padding: 0.3rem;
  border-radius: 6px;
  color: #475569;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.mobile-menu-btn:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.mobile-brand {
  font-weight: 800;
  font-size: 1.1rem;
  color: #0f172a;
  letter-spacing: -0.03em;
}

/* ── Sidebar backdrop ── */
.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1039;
}

/* ── Sidebar ── */
.sidebar {
  width: 208px;
  flex-shrink: 0;
  background: #f8fafc;
  border-right: 1px solid #e8ecf0;
  display: flex;
  flex-direction: column;
  transition: width 0.28s ease;
  overflow: hidden;
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 1040;
}

.sidebar.sidebar-collapsed {
  width: 56px;
}

/* Header */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #e8ecf0;
  flex-shrink: 0;
}

.sidebar-header.sidebar-header-collapsed {
  justify-content: center;
}

.sidebar-brand {
  font-weight: 800;
  font-size: 1.15rem;
  color: #0f172a;
  white-space: nowrap;
  letter-spacing: -0.03em;
}

.sidebar-toggle {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0.3rem 0.35rem;
  border-radius: 6px;
  line-height: 1;
  transition: color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}

.sidebar-toggle:hover {
  color: #475569;
  background: #e8ecf0;
}

/* Nav */
.sidebar-nav {
  flex: 1;
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow-y: auto;
  min-height: 0;
}

/* Shared item styles */
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  color: #475569;
  text-decoration: none !important;
  font-weight: 500;
  font-size: 0.875rem;
  white-space: nowrap;
  transition: color 0.15s ease, background 0.15s ease;
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-family: inherit;
  line-height: 1.4;
}

.sidebar-item i {
  font-size: 1rem;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.sidebar-item:hover {
  color: #0f172a;
  background: #eef2f6;
}

.sidebar-item.active {
  color: var(--theme-primary);
  background: rgba(0, 0, 0, 0.06);
  font-weight: 600;
}

.sidebar-item.active i {
  color: var(--theme-primary);
}

/* Footer */
.sidebar-footer {
  padding: 0.6rem;
  border-top: 1px solid #e8ecf0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex-shrink: 0;
}

.sidebar-user-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-logout {
  color: #475569;
}

.sidebar-logout:hover {
  color: #111827;
  background: #eef2f6;
}

/* Main content */
.main-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

.main-content.is-desktop {
  background: #000000;
}

/* ── Mobile breakpoint ── */
@media (max-width: 767px) {
  .mobile-topbar {
    display: flex;
  }

  .sidebar-backdrop {
    display: block;
  }

  /* Sidebar hidden off-screen by default on mobile */
  .sidebar {
    position: fixed;
    top: 0;
    left: -208px;
    height: 100dvh; /* accounts for mobile browser chrome */
    transition: left 0.28s ease;
    width: 208px !important; /* ignore collapsed state on mobile */
  }

  /* Slide in when open */
  .sidebar.mobile-open {
    left: 0;
  }

  /* Always show all text on mobile (not collapsed) */
  .sidebar.mobile-open .sidebar-brand,
  .sidebar.mobile-open .sidebar-item span,
  .sidebar.mobile-open .sidebar-user-label {
    display: block !important;
  }

  /* Shift content down only when the topbar is visible */
  .main-content.has-topbar {
    padding-top: 52px;
  }
}
</style>
