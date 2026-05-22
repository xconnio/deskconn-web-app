import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import RegisterView from '../views/RegisterView.vue'
import VerifyView from '../views/VerifyView.vue'
import HomeView from '../views/HomeView.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { requiresAuth: true },
    },
    {
      path: '/organizations',
      name: 'organizations',
      component: () => import('../views/OrganizationsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/organizations/:id',
      name: 'organization-detail',
      component: () => import('../views/OrganizationDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresGuest: true },
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { requiresGuest: true },
    },
    {
      path: '/verify',
      name: 'verify',
      component: VerifyView,
      meta: { requiresGuest: true },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('../views/ForgotPasswordView.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/access-management',
      name: 'access-management',
      component: () => import('../views/AccessManagementView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/access-management/machines/:id',
      name: 'machine-access',
      component: () => import('../views/MachineAccessView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/access-management/machines/:desktopId/orgs/:accessId',
      name: 'desktop-org-access',
      component: () => import('../views/OrgDesktopAccessView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/desktops/:realm/launcher',
      name: 'desktop-launcher',
      component: () => import('../views/LauncherView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/desktops/:realm/files',
      name: 'desktop-files',
      component: () => import('../views/DesktopFilesView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.meta.requiresGuest && authStore.isAuthenticated) {
    next('/')
  } else {
    next()
  }
})

export default router
