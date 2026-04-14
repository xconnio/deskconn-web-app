<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { authService } from '../services/authService'
import type { Organization } from '../types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const orgId = route.params.id as string

// State
const organization = ref<Organization | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')

// Modal State for Edit
const showEditModal = ref(false)
const editOrgName = ref('')
const isUpdating = ref(false)
const modalErrorMessage = ref('')

// Modal State for Delete
const showDeleteModal = ref(false)
const isDeleting = ref(false)
const deleteErrorMessage = ref('')

const fetchOrganizationDetails = async () => {
  if (!authStore.session) return
  
  isLoading.value = true
  try {
    const result = await authService.getOrganization(authStore.session, orgId)
    organization.value = result.args[0]
    if (organization.value) {
      editOrgName.value = organization.value.name
    }
  } catch (err: unknown) {
    console.error('Failed to fetch organization details', err)
    errorMessage.value = err instanceof Error ? err.message : 'Failed to load organization'
  } finally {
    isLoading.value = false
  }
}

// Watch for session changes (e.g., after auto-login)
watch(() => authStore.session, (newSession) => {
  if (newSession && !organization.value) {
    fetchOrganizationDetails()
  }
}, { immediate: true })

onMounted(() => {
  if (authStore.session) {
    fetchOrganizationDetails()
  }
})

const handleOpenEditModal = () => {
  if (organization.value) {
    editOrgName.value = organization.value.name
    showEditModal.value = true
  }
}

const handleCancelEdit = () => {
  showEditModal.value = false
  modalErrorMessage.value = ''
}

const handleUpdateOrg = async () => {
  if (!organization.value || !editOrgName.value.trim() || editOrgName.value === organization.value.name) {
    handleCancelEdit()
    return
  }

  isUpdating.value = true
  modalErrorMessage.value = ''

  try {
    if (!authStore.session) throw new Error('No active session')

    await authService.updateOrganization(authStore.session, orgId, editOrgName.value)
    
    // Update local state
    if (organization.value) {
      organization.value.name = editOrgName.value
    }
    handleCancelEdit()
  } catch (err: unknown) {
    console.error('Failed to update organization', err)
    modalErrorMessage.value = err instanceof Error ? err.message : 'Failed to update organization'
  } finally {
    isUpdating.value = false
  }
}

const handleOpenDeleteModal = () => {
  showDeleteModal.value = true
}

const handleCancelDelete = () => {
  showDeleteModal.value = false
  deleteErrorMessage.value = ''
}

const handleDeleteOrg = async () => {
  isDeleting.value = true
  deleteErrorMessage.value = ''

  try {
    if (!authStore.session) throw new Error('No active session')

    await authService.deleteOrganization(authStore.session, orgId)
    
    // Redirect to organizations on success
    router.push('/organizations')
  } catch (err: unknown) {
    console.error('Failed to delete organization', err)
    deleteErrorMessage.value = err instanceof Error ? err.message : 'Failed to delete organization'
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div class="container py-3 py-md-5 fade-in-up">
    <!-- Navigation -->
    <div class="row mb-4 justify-content-center">
      <div class="col-lg-10">
        <router-link to="/organizations" class="btn btn-link text-decoration-none text-muted p-0 d-flex align-items-center back-link mb-3">
          <i class="bi bi-arrow-left-short fs-2 me-1"></i>
          <span class="fw-semibold">Back to Organizations</span>
        </router-link>
        <nav aria-label="breadcrumb">
          <ol class="breadcrumb mb-0">
            <li class="breadcrumb-item"><router-link to="/organizations" class="text-decoration-none text-primary opacity-75">Organizations</router-link></li>
            <li class="breadcrumb-item active" aria-current="page">Organization</li>
          </ol>
        </nav>
      </div>
    </div>

    <!-- Header Section -->
    <div v-if="organization" class="row mb-5 justify-content-center">
      <div class="col-lg-10">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <h1 class="display-5 fw-bold mb-0">{{ organization.name }}</h1>
            <p class="text-muted lead mb-0">Organization Management</p>
          </div>
          <div class="d-flex gap-2 flex-shrink-0">
            <button @click="handleOpenEditModal" class="btn btn-primary rounded-pill px-3 px-md-4 py-2 fw-bold shadow-sm">
              <i class="bi bi-pencil-square me-1 me-md-2"></i><span class="d-none d-sm-inline">Edit</span>
            </button>
            <button @click="handleOpenDeleteModal" class="btn btn-theme-danger rounded-pill px-3 px-md-4 py-2 fw-bold shadow-sm">
              <i class="bi bi-trash me-1 me-md-2"></i><span class="d-none d-sm-inline">Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="errorMessage" class="row justify-content-center">
      <div class="col-lg-10">
        <div class="alert alert-danger d-flex align-items-center" role="alert">
          <i class="bi bi-exclamation-triangle-fill me-2"></i>
          <div>{{ errorMessage }}</div>
        </div>
        <button @click="router.push('/organizations')" class="btn btn-outline-primary mt-3">
          <i class="bi bi-arrow-left me-2"></i> Back to Organizations
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading && !organization" class="row justify-content-center">
      <div class="col-lg-10 text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
    </div>

    <div v-if="organization" class="row justify-content-center g-4">
      <!-- Members Section -->
      <div class="col-lg-10">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-dark me-3 p-2">
              <i class="bi bi-people"></i>
            </span>
            Members
          </h3>
        </div>

        <div class="card border-0 shadow-sm">
          <div class="list-group list-group-flush rounded-3">
            <div v-for="member in organization.members" :key="member.user_id" class="list-group-item border-0 p-3">
              <div class="d-flex align-items-center">
                <div class="avatar-sm bg-light text-dark rounded-circle d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px;">
                  {{ member.user.name?.charAt(0) || member.user.email?.charAt(0) || '?' }}
                </div>
                <div>
                  <h6 class="mb-0">{{ member.user.name || 'Unknown' }}</h6>
                  <small class="text-muted d-block text-truncate member-email">{{ member.user.email || 'No email' }}</small>
                  <span class="badge bg-light text-primary small text-capitalize mt-1">{{ member.role }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Organization Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="handleCancelEdit">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
          <div class="modal-header border-0 p-4 pb-0">
            <h4 class="modal-title fw-bold">Edit Organization</h4>
            <button type="button" class="btn-close shadow-none" @click="handleCancelEdit"></button>
          </div>
          <div class="modal-body p-4 py-5">
            <div class="mb-2">
              <label class="form-label mb-2">Organization Name</label>
              <input 
                v-model="editOrgName" 
                type="text" 
                class="form-control form-control-lg theme-input" 
                placeholder="Enter organization name"
                @keyup.enter="handleUpdateOrg"
                autofocus
              >
            </div>
            <div v-if="modalErrorMessage" class="text-danger small mt-2 d-flex align-items-center">
              <i class="bi bi-exclamation-circle me-1"></i> {{ modalErrorMessage }}
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button type="button" class="btn btn-link text-muted text-decoration-none fw-semibold me-auto" @click="handleCancelEdit">
              Cancel
            </button>
            <button 
              type="button" 
              class="btn btn-theme-primary rounded-pill px-5 py-2 fw-bold" 
              @click="handleUpdateOrg"
              :disabled="!editOrgName.trim() || isUpdating"
            >
              <span v-if="isUpdating" class="spinner-border spinner-border-sm me-2"></span>
              {{ isUpdating ? 'Updating...' : 'Update' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="handleCancelDelete">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
          <div class="modal-header border-0 p-4 pb-0">
            <h4 class="modal-title fw-bold text-danger">Delete Organization</h4>
            <button type="button" class="btn-close shadow-none" @click="handleCancelDelete"></button>
          </div>
          <div class="modal-body p-4 py-5 text-center">
            <div class="mb-4">
              <i class="bi bi-exclamation-triangle-fill text-danger display-1 opacity-25"></i>
            </div>
            <h5 class="fw-bold mb-3">Are you absolutely sure?</h5>
            <p v-if="organization" class="text-muted mb-0">
              You are about to delete <strong>{{ organization.name }}</strong>. This action cannot be undone and will remove all associated data.
            </p>
            <div v-if="deleteErrorMessage" class="text-danger small mt-4 d-flex align-items-center justify-content-center">
              <i class="bi bi-exclamation-circle me-1"></i> {{ deleteErrorMessage }}
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button type="button" class="btn btn-link text-muted text-decoration-none fw-semibold me-auto" @click="handleCancelDelete">
              No, Keep it
            </button>
            <button 
              type="button" 
              class="btn btn-theme-danger rounded-pill px-5 py-2 fw-bold" 
              @click="handleDeleteOrg"
              :disabled="isDeleting"
            >
              <span v-if="isDeleting" class="spinner-border spinner-border-sm me-2"></span>
              {{ isDeleting ? 'Deleting...' : 'Yes, Delete' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.breadcrumb-item + .breadcrumb-item::before {
  content: "›";
  font-size: 1.2rem;
  line-height: 1;
}

.back-link {
  transition: all 0.2s ease;
  opacity: 0.8;
  color: #64748b !important;
}

.back-link:hover {
  opacity: 1;
  color: var(--theme-primary) !important;
  transform: translateX(-4px);
}

.avatar-sm {
  font-weight: 600;
  font-size: 1rem;
}

.member-email {
  max-width: 240px;
}

.card-hover:hover {
  transform: translateY(-2px);
  transition: transform 0.2s ease;
}
</style>
