<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { useAuthStore } from './stores/auth'
import { useMachinesStore } from './stores/machines'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const machinesStore = useMachinesStore()

const sidebarCollapsed = ref(false)
const mobileOpen = ref(false)
const machinesExpanded = ref(true)

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

const toggleMachinesExpanded = () => {
  machinesExpanded.value = !machinesExpanded.value
}

const handleMachinesSectionClick = () => {
  toggleMachinesExpanded()

  if (route.name !== 'home') {
    router.push('/')
  }
}

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

const isMachinesRoute = () => route.path === '/' || route.name === 'desktop-files'

// Close mobile sidebar on route change
watch(() => route.fullPath, () => {
  mobileOpen.value = false
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
</script>

<template>
  <div class="app-wrapper">

    <!-- Mobile top bar -->
    <header
      v-if="!route.meta.hideNavbar && authStore.isAuthenticated"
      class="mobile-topbar"
    >
      <button class="mobile-menu-btn" @click="mobileOpen = true">
        <i class="bi bi-list"></i>
      </button>
      <span class="mobile-brand">Deskconn</span>
    </header>

    <!-- Backdrop (mobile only) -->
    <div
      v-if="!route.meta.hideNavbar && authStore.isAuthenticated && mobileOpen"
      class="sidebar-backdrop"
      @click="mobileOpen = false"
    />

    <!-- Sidebar -->
    <aside
      v-if="!route.meta.hideNavbar && authStore.isAuthenticated"
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
        <div class="sidebar-section">
          <button
            type="button"
            class="sidebar-item sidebar-section-header"
            :class="{ active: isMachinesRoute() }"
            :title="sidebarCollapsed ? 'Machines' : ''"
            @click="handleMachinesSectionClick"
          >
            <i class="bi bi-pc-display"></i>
            <span v-if="!sidebarCollapsed">Machines</span>
            <i
              v-if="!sidebarCollapsed"
              class="bi sidebar-section-chevron"
              :class="machinesExpanded ? 'bi-chevron-up' : 'bi-chevron-down'"
            ></i>
          </button>

          <transition name="sidebar-expand">
            <div v-if="!sidebarCollapsed && machinesExpanded" class="sidebar-subnav">
              <div v-if="machinesStore.isLoadingDesktops" class="sidebar-subitem sidebar-subitem-muted">
                Loading machines...
              </div>

              <div
                v-for="desktop in machinesStore.desktops"
                :key="desktop.realm"
                class="sidebar-subitem"
              >
                <span class="sidebar-subitem-icon" aria-hidden="true">
                  {{ desktop.icon }}
                </span>
                <span class="sidebar-subitem-label">{{ desktop.name }}</span>
              </div>

              <div
                v-if="!machinesStore.isLoadingDesktops && machinesStore.desktops.length === 0"
                class="sidebar-subitem sidebar-subitem-muted"
              >
                No machines found
              </div>
            </div>
          </transition>
        </div>

        <router-link
          to="/organizations"
          class="sidebar-item"
          :class="{ active: isActive('/organizations') }"
          :title="sidebarCollapsed ? 'Organizations' : ''"
        >
          <i class="bi bi-building"></i>
          <span v-if="!sidebarCollapsed">Organizations</span>
        </router-link>

        <router-link
          to="/settings"
          class="sidebar-item"
          :class="{ active: isActive('/settings') }"
          :title="sidebarCollapsed ? 'Settings' : ''"
        >
          <i class="bi bi-gear"></i>
          <span v-if="!sidebarCollapsed">Settings</span>
        </router-link>
      </nav>

      <!-- Footer: profile link + logout -->
      <div class="sidebar-footer">
        <router-link
          to="/profile"
          class="sidebar-item sidebar-user"
          :class="{ active: isActive('/profile') }"
          :title="sidebarCollapsed ? 'Profile' : ''"
        >
          <i class="bi bi-person-circle"></i>
          <span v-if="!sidebarCollapsed" class="sidebar-user-label">
            Hello, {{ authStore.user?.name || authStore.user?.email }}
          </span>
        </router-link>

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
      :class="{ 'has-topbar': !route.meta.hideNavbar && authStore.isAuthenticated }"
    >
      <RouterView />
    </main>

  </div>
</template>

<style>
body {
  background: #ffffff;
  min-height: 100vh;
}

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
  width: 240px;
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
  width: 64px;
}

/* Header */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 1rem;
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

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sidebar-section-header {
  justify-content: space-between;
}

.sidebar-section-chevron {
  margin-left: auto;
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

.sidebar-subnav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.1rem 0 0.15rem 1.7rem;
}

.sidebar-subitem {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  background: transparent;
  color: #64748b;
  border-radius: 8px;
  padding: 0.55rem 0.75rem;
  text-align: left;
  font-size: 0.90rem;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.5;
  cursor: default;
  transition: color 0.15s ease, background 0.15s ease;
}

.sidebar-subitem:hover {
  color: #0f172a;
  background: rgba(148, 163, 184, 0.12);
}

.sidebar-subitem-muted {
  color: #94a3b8;
  cursor: default;
}

.sidebar-subitem-icon {
  width: 20px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  line-height: 1;
}

.sidebar-subitem-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
    left: -240px;
    height: 100dvh; /* accounts for mobile browser chrome */
    transition: left 0.28s ease;
    width: 240px !important; /* ignore collapsed state on mobile */
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
