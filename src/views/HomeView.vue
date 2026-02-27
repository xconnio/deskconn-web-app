<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { authService } from '../services/authService'
import type { Organization, Device, Desktop } from '../types'

const authStore = useAuthStore()

// State
const organizations = ref<Organization[]>([])
const desktops = ref<Desktop[]>([])
const isLoadingOrgs = ref(true)
const isLoadingDesktops = ref(true)

// Mock data for Devices
const devices = ref<Device[]>([
  { id: 'd1', name: 'MacBook Pro M3', type: 'Laptop', status: 'Online', icon: '💻' },
  { id: 'd2', name: 'iPhone 15 Pro', type: 'Mobile', status: 'Offline', icon: '📱' },
  { id: 'd3', name: 'iPad Air', type: 'Tablet', status: 'Online', icon: '平板' },
])

// Modal State
const showModal = ref(false)
const newOrgName = ref('')
const isCreating = ref(false)
const errorMessage = ref('')

const fetchOrganizations = async () => {
  if (!authStore.session) {
    isLoadingOrgs.value = false
    return
  }

  isLoadingOrgs.value = true
  try {
    const result = await authService.listOrganizations(authStore.session)
    organizations.value = result.args.map((org: Organization) => ({
      ...org,
      role: 'Member', // Default role for display
      icon: '🏢'       // Default icon
    }))
  } catch (err: unknown) {
    console.error('Failed to fetch organizations', err)
  } finally {
    isLoadingOrgs.value = false
  }
}

const fetchDesktops = async () => {
  if (!authStore.session) {
    isLoadingDesktops.value = false
    return
  }

  isLoadingDesktops.value = true
  try {
    const result = await authService.listDesktops(authStore.session)
    desktops.value = result.args.map((desktop: Desktop) => ({
      ...desktop,
      icon: '🖥️', // Default icon
    }))
  } catch (err: unknown) {
    console.error('Failed to fetch organizations', err)
  } finally {
    isLoadingDesktops.value = false
  }
}

// Watch for session changes (e.g., after auto-login)
watch(
  () => authStore.session,
  (newSession) => {
    if (newSession) {
      fetchOrganizations()
      fetchDesktops()
    } else {
      isLoadingOrgs.value = false
      isLoadingDesktops.value = false
    }
  },
  { immediate: true },
)

onMounted(() => {
  // If session is already present, fetch immediately
  if (authStore.session) {
    fetchOrganizations()
    fetchDesktops()
  } else {
    // If not, the watcher will handle it, but let's make sure we don't hang forever
    // if auto-login is not even running or fails.
    // authStore.autoLogin is called in App.vue, so we wait for its result indirectly.
  }
})

const handleOpenModal = () => {
  showModal.value = true
}

const handleCancel = () => {
  showModal.value = false
  newOrgName.value = ''
  errorMessage.value = ''
}

const handleCreateOrg = async () => {
  if (!newOrgName.value.trim()) return

  isCreating.value = true
  errorMessage.value = ''

  try {
    if (!authStore.session) {
      throw new Error('No active session found')
    }

    await authService.createOrganization(authStore.session, newOrgName.value)

    // Successfully created, fetch fresh list
    await fetchOrganizations()

    handleCancel()
  } catch (err: unknown) {
    console.error('Failed to create organization', err)
    errorMessage.value = err instanceof Error ? err.message : 'Failed to create organization'
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="container py-5 fade-in-up">
    <!-- Header Section -->
    <div class="row mb-5 justify-content-center">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-end">
          <div>
            <h1 class="display-5 fw-bold mb-0">Dashboard</h1>
            <p class="text-muted lead">Welcome back, {{ authStore.user?.name || authStore.user?.email }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Organizations Section -->
    <div class="row justify-content-center mb-5">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-primary me-3 p-2">
              <i class="bi bi-building"></i>
            </span>
            Organizations
          </h3>
          <button @click="handleOpenModal" class="btn btn-primary btn-sm rounded-pill px-3 shadow-none no-underline-hover">
            <i class="bi bi-plus-lg me-1"></i> Add New
          </button>
        </div>

        <div v-if="isLoadingOrgs" class="row g-4">
          <div v-for="i in 3" :key="i" class="col-md-4">
            <div class="card h-100 border-0 shadow-sm opacity-50">
              <div class="card-body p-4 text-center">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="row g-4">
          <div v-for="org in organizations" :key="org.id" class="col-md-4">
            <router-link :to="'/organizations/' + org.id" class="text-decoration-none">
              <div class="card h-100 border-0 shadow-sm card-hover">
                <div class="card-body p-4">
                  <div class="d-flex align-items-center mb-3">
                    <span class="fs-2 me-3">{{ org.icon }}</span>
                    <div>
                      <h5 class="card-title mb-0 text-dark">{{ org.name }}</h5>
                      <small class="text-muted">{{ org.role }}</small>
                    </div>
                  </div>
                  <div class="mt-auto d-flex justify-content-between align-items-center">
                    <span class="badge bg-light text-primary rounded-pill">View Details</span>
                    <i class="bi bi-chevron-right text-muted"></i>
                  </div>
                </div>
              </div>
            </router-link>
          </div>

          <!-- Empty State -->
          <div v-if="organizations.length === 0" class="col-12">
            <div class="card border-dashed p-5 text-center bg-transparent">
              <p class="text-muted mb-0">No organizations found. Create your first one!</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Desktops Section -->
    <div class="row justify-content-center mb-5">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-secondary me-3 p-2">
              <i class="bi bi-pc-display"></i>
            </span>
            Desktops
          </h3>
        </div>

        <div v-if="isLoadingDesktops" class="row g-4">
          <div v-for="i in 3" :key="i" class="col-md-4">
            <div class="card h-100 border-0 shadow-sm opacity-50">
              <div class="card-body p-4 text-center">
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="row g-4">
          <div v-for="desktop in desktops" :key="desktop.realm" class="col-md-4">
            <div class="card h-100 border-0 shadow-sm card-hover">
              <div class="card-body p-4">
                <div class="d-flex align-items-center mb-3">
                  <span class="fs-2 me-3">{{ desktop.icon }}</span>
                  <div>
                    <h5 class="card-title mb-0 text-dark">{{ desktop.name }}</h5>
                  </div>
                </div>
                <div class="mt-auto d-flex justify-content-between align-items-center">
                  <span class="badge bg-light text-primary rounded-pill">View Details</span>
                  <i class="bi bi-chevron-right text-muted"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-if="desktops.length === 0" class="col-12">
            <div class="card border-dashed p-5 text-center bg-transparent">
              <p class="text-muted mb-0">No desktops found</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Devices Section -->
    <div class="row justify-content-center">
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-secondary me-3 p-2">
              <i class="bi bi-laptop"></i>
            </span>
            Devices
          </h3>
        </div>

        <div class="row g-4">
          <div v-for="device in devices" :key="device.id" class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
              <div class="card-body p-4">
                <div class="d-flex align-items-center mb-3">
                  <span class="fs-2 me-3">{{ device.icon }}</span>
                  <div>
                    <h5 class="card-title mb-0">{{ device.name }}</h5>
                    <small class="text-muted">{{ device.type }}</small>
                  </div>
                </div>
                <div class="d-flex align-items-center">
                  <span
                    class="status-indicator me-2"
                    :class="device.status === 'Online' ? 'bg-success' : 'bg-danger'"
                  ></span>
                  <small :class="device.status === 'Online' ? 'text-success' : 'text-danger'">
                    {{ device.status }}
                  </small>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-if="devices.length === 0" class="col-12">
            <div class="card border-dashed p-5 text-center bg-transparent">
              <p class="text-muted mb-0">No devices registered to this account.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Organization Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="handleCancel">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
          <div class="modal-header border-0 p-4 pb-0">
            <h4 class="modal-title fw-bold">Add New Organization</h4>
            <button type="button" class="btn-close shadow-none" @click="handleCancel"></button>
          </div>
          <div class="modal-body p-4 py-5">
            <div class="mb-2">
              <label class="form-label mb-2">Organization Name</label>
              <input
                v-model="newOrgName"
                type="text"
                class="form-control form-control-lg theme-input"
                placeholder="Enter organization name"
                @keyup.enter="handleCreateOrg"
                autofocus
              >
            </div>
            <div v-if="errorMessage" class="text-danger small mt-2 d-flex align-items-center">
              <i class="bi bi-exclamation-circle me-1"></i> {{ errorMessage }}
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button type="button" class="btn btn-link text-muted text-decoration-none fw-semibold me-auto" @click="handleCancel">
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-theme-primary rounded-pill px-5 py-2 fw-bold"
              @click="handleCreateOrg"
              :disabled="!newOrgName.trim() || isCreating"
            >
              <span v-if="isCreating" class="spinner-border spinner-border-sm me-2"></span>
              {{ isCreating ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-hover {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card-hover:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1) !important;
}

/* Theme Primary Button Override for consistency */
.btn-theme-primary {
  background-color: var(--theme-yellow) !important;
  border-color: var(--theme-yellow) !important;
  color: white !important;
  box-shadow: 0 4px 6px rgba(255, 184, 0, 0.2);
  transition: all 0.2s ease;
}

.btn-theme-primary:hover:not(:disabled) {
  background-color: #e5a500 !important;
  border-color: #e5a500 !important;
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(255, 184, 0, 0.3);
}

.btn-theme-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: var(--theme-yellow) !important; /* Keep yellow even when disabled */
}

.badge {
  font-weight: 600;
}

/* Ensure icons/emojis don't break layout */
.fs-2 {
  min-width: 40px;
  text-align: center;
}

.no-underline-hover:hover {
  text-decoration: none !important;
  background-color: #e5a500 !important; /* Darker yellow on hover for better visibility */
}

/* Fix for Add New button hover state */
.btn-primary.no-underline-hover:hover {
  color: white !important;
  text-decoration: none !important;
}
</style>
