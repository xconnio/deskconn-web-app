<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useMachinesStore } from '../stores/machines'
import { authService } from '../services/authService'
import type { Organization, DesktopInvite, OrganizationInvite } from '../types'

const router = useRouter()
const authStore = useAuthStore()
const machinesStore = useMachinesStore()

type Tab = 'machines' | 'organizations' | 'invitations'
const activeTab = ref<Tab>('machines')

// --- Organizations ---
const organizations = ref<Organization[]>([])
const isLoadingOrgs = ref(false)
const showCreateOrgModal = ref(false)
const newOrgName = ref('')
const isCreatingOrg = ref(false)
const createOrgError = ref('')

// --- Desktop Invitations ---
const invitations = ref<DesktopInvite[]>([])
const isLoadingInvitations = ref(false)
const respondingId = ref<string | null>(null)
const respondError = ref('')

// --- Org Invitations ---
const orgInvitations = ref<OrganizationInvite[]>([])
const isLoadingOrgInvitations = ref(false)
const respondingOrgId = ref<string | null>(null)
const respondOrgError = ref('')

// --- Computed ---
const accessibleMachines = computed(() =>
  machinesStore.desktops.filter((d) => d.role === 'owner' || d.role === 'admin'),
)

// --- Fetch ---
const fetchOrganizations = async () => {
  if (!authStore.session) return
  isLoadingOrgs.value = true
  try {
    const result = await authService.listOrganizations(authStore.session)
    organizations.value = result.args as Organization[]
  } catch (err) {
    console.error('Failed to fetch organizations', err)
  } finally {
    isLoadingOrgs.value = false
  }
}

const fetchInvitations = async () => {
  if (!authStore.session) return
  isLoadingInvitations.value = true
  respondError.value = ''
  try {
    const result = await authService.listDesktopInvitesInbox(authStore.session)
    invitations.value = result.args as DesktopInvite[]
  } catch (err) {
    console.error('Failed to fetch desktop invitations', err)
  } finally {
    isLoadingInvitations.value = false
  }
}

const fetchOrgInvitations = async () => {
  if (!authStore.session) return
  isLoadingOrgInvitations.value = true
  respondOrgError.value = ''
  try {
    const result = await authService.listOrgInvitesInbox(authStore.session)
    orgInvitations.value = result.args as OrganizationInvite[]
  } catch (err) {
    console.error('Failed to fetch org invitations', err)
  } finally {
    isLoadingOrgInvitations.value = false
  }
}

watch(
  () => authStore.session,
  (session) => {
    if (session) {
      fetchOrganizations()
      fetchInvitations()
      fetchOrgInvitations()
    }
  },
  { immediate: true },
)

// --- Create org ---
const handleCreateOrgEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCreateOrgModal() }
watch(showCreateOrgModal, (open) => {
  if (open) document.addEventListener('keydown', handleCreateOrgEsc)
  else document.removeEventListener('keydown', handleCreateOrgEsc)
})
onUnmounted(() => document.removeEventListener('keydown', handleCreateOrgEsc))

const closeCreateOrgModal = () => {
  showCreateOrgModal.value = false
  newOrgName.value = ''
  createOrgError.value = ''
}

const handleCreateOrg = async () => {
  if (!authStore.session || !newOrgName.value.trim()) return
  isCreatingOrg.value = true
  createOrgError.value = ''
  try {
    await authService.createOrganization(authStore.session, newOrgName.value.trim())
    await fetchOrganizations()
    closeCreateOrgModal()
  } catch (err) {
    createOrgError.value = err instanceof Error ? err.message : 'Failed to create organization'
  } finally {
    isCreatingOrg.value = false
  }
}

// --- Tab switching with refetch ---
const setTab = (tab: Tab) => {
  activeTab.value = tab
  if (!authStore.session) return
  if (tab === 'machines') machinesStore.fetchMachines(authStore.session, true)
  if (tab === 'organizations') fetchOrganizations()
  if (tab === 'invitations') { fetchInvitations(); fetchOrgInvitations() }
}

// --- Respond to org invite ---
const handleRespondOrg = async (invite: OrganizationInvite, status: 'accepted' | 'rejected') => {
  if (!authStore.session) return
  respondingOrgId.value = invite.id
  respondOrgError.value = ''
  try {
    await authService.respondToOrgInvite(authStore.session, invite.id, status)
    orgInvitations.value = orgInvitations.value.filter((i) => i.id !== invite.id)
  } catch (err) {
    respondOrgError.value = err instanceof Error ? err.message : 'Failed to respond to invitation'
  } finally {
    respondingOrgId.value = null
  }
}

// --- Respond to desktop invite ---
const handleRespond = async (invite: DesktopInvite, status: 'accepted' | 'rejected') => {
  if (!authStore.session) return
  respondingId.value = invite.id
  respondError.value = ''
  try {
    await authService.respondToDesktopInvite(authStore.session, invite.id, status)
    invitations.value = invitations.value.filter((i) => i.id !== invite.id)
    if (status === 'accepted') {
      await machinesStore.fetchMachines(authStore.session, true)
    }
  } catch (err) {
    respondError.value = err instanceof Error ? err.message : 'Failed to respond to invitation'
  } finally {
    respondingId.value = null
  }
}
</script>

<template>
  <div class="container py-3 py-md-5 fade-in-up">
    <div class="row justify-content-center mb-5">
      <div class="col-lg-10">

        <!-- Header -->
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h3 class="mb-0 d-flex align-items-center">
            <span class="badge bg-secondary me-3 p-2">
              <i class="bi bi-shield-lock"></i>
            </span>
            Access Management
          </h3>
        </div>

        <!-- Tabs -->
        <ul class="nav nav-tabs mb-4" role="tablist">
          <li class="nav-item">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'machines' }"
              @click="setTab('machines')"
            >
              <i class="bi bi-pc-display me-2"></i>Machines
              <span class="badge rounded-pill ms-2" :class="accessibleMachines.length ? 'bg-secondary' : 'bg-light text-muted'">
                {{ accessibleMachines.length }}
              </span>
            </button>
          </li>
          <li class="nav-item">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'organizations' }"
              @click="setTab('organizations')"
            >
              <i class="bi bi-building me-2"></i>Organizations
              <span class="badge rounded-pill ms-2" :class="organizations.length ? 'bg-secondary' : 'bg-light text-muted'">
                {{ organizations.length }}
              </span>
            </button>
          </li>
          <li class="nav-item">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'invitations' }"
              @click="setTab('invitations')"
            >
              <i class="bi bi-envelope me-2"></i>Invitations
              <span
                class="badge rounded-pill ms-2"
                :class="(invitations.length + orgInvitations.length) ? 'bg-primary' : 'bg-light text-muted'"
              >
                {{ invitations.length + orgInvitations.length }}
              </span>
            </button>
          </li>
        </ul>

        <!-- ── Machines tab ── -->
        <div v-if="activeTab === 'machines'">
          <p class="text-muted small mb-4">Manage who can access your machines</p>

          <div v-if="machinesStore.isLoadingDesktops" class="row g-4">
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
            <div v-for="m in accessibleMachines" :key="m.id" class="col-md-4">
              <div class="card h-100 border-0 shadow-sm card-hover-static">
                <div class="card-body p-4 d-flex flex-column">
                  <div class="d-flex align-items-center mb-3">
                    <span class="fs-2 me-3">{{ m.icon }}</span>
                    <div>
                      <h5 class="card-title mb-0 text-dark">{{ m.name }}</h5>
                      <small
                        class="badge bg-light border text-capitalize"
                        :class="m.role === 'owner' ? 'text-success border-success-subtle' : 'text-primary border-primary-subtle'"
                      >{{ m.role }}</small>
                    </div>
                  </div>
                  <div class="mt-auto">
                    <button
                      class="btn btn-outline-primary btn-sm rounded-pill w-100"
                      @click="router.push(`/access-management/machines/${m.id}`)"
                    >
                      <i class="bi bi-people me-1"></i> Manage Access
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="accessibleMachines.length === 0" class="col-12">
              <div class="card border-dashed p-5 text-center bg-transparent">
                <p class="text-muted mb-0">You don't have access to any machines yet.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Organizations tab ── -->
        <div v-if="activeTab === 'organizations'">
          <div class="d-flex justify-content-between align-items-center mb-4">
            <p class="text-muted small mb-0">Create and manage your organizations</p>
            <button
              class="btn btn-primary btn-sm rounded-pill px-3 shadow-none no-underline-hover"
              @click="showCreateOrgModal = true"
            >
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
              <router-link :to="`/organizations/${org.id}`" class="text-decoration-none">
                <div class="card h-100 border-0 shadow-sm card-hover">
                  <div class="card-body p-4">
                    <div class="d-flex align-items-center mb-3">
                      <span class="fs-2 me-3">🏢</span>
                      <div>
                        <h5 class="card-title mb-0 text-dark">{{ org.name }}</h5>
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

            <div v-if="organizations.length === 0" class="col-12">
              <div class="card border-dashed p-5 text-center bg-transparent">
                <p class="text-muted mb-0">No organizations found. Create your first one!</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Invitations tab ── -->
        <div v-if="activeTab === 'invitations'">
          <p class="text-muted small mb-4">Pending invitations to machines and organizations</p>

          <!-- Machine invitations -->
          <h6 class="fw-semibold text-muted text-uppercase mb-2" style="font-size: 0.75rem; letter-spacing: 0.05em;">
            <i class="bi bi-pc-display me-1"></i> Machines
          </h6>

          <div v-if="respondError" class="alert alert-danger d-flex align-items-center mb-3 py-2" role="alert">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ respondError }}
          </div>

          <div v-if="isLoadingInvitations" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
          </div>

          <div v-else-if="invitations.length === 0" class="card border-dashed p-4 text-center bg-transparent mb-4">
            <p class="text-muted small mb-0">No pending machine invitations.</p>
          </div>

          <div v-else class="card border-0 shadow-sm mb-4">
            <div class="list-group list-group-flush rounded-3">
              <div v-for="invite in invitations" :key="invite.id" class="list-group-item border-0 p-4">
                <div class="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                  <div class="d-flex align-items-center gap-3 min-w-0">
                    <div class="invite-icon">
                      <i class="bi bi-pc-display fs-5 text-primary"></i>
                    </div>
                    <div class="min-w-0">
                      <div class="fw-semibold text-dark">{{ invite.desktop?.name ?? 'A machine' }}</div>
                      <div class="text-muted small">
                        Invited with
                        <span class="badge bg-light text-dark border ms-1">{{ invite.role }}</span>
                        access
                      </div>
                    </div>
                  </div>
                  <div class="d-flex gap-2 flex-shrink-0">
                    <button
                      class="btn btn-sm btn-outline-success rounded-pill px-3"
                      :disabled="respondingId === invite.id"
                      @click="handleRespond(invite, 'accepted')"
                    >
                      <span v-if="respondingId === invite.id" class="spinner-border spinner-border-sm me-1"></span>
                      Accept
                    </button>
                    <button
                      class="btn btn-sm btn-outline-danger rounded-pill px-3"
                      :disabled="respondingId === invite.id"
                      @click="handleRespond(invite, 'rejected')"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Organization invitations -->
          <h6 class="fw-semibold text-muted text-uppercase mb-2" style="font-size: 0.75rem; letter-spacing: 0.05em;">
            <i class="bi bi-building me-1"></i> Organizations
          </h6>

          <div v-if="respondOrgError" class="alert alert-danger d-flex align-items-center mb-3 py-2" role="alert">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ respondOrgError }}
          </div>

          <div v-if="isLoadingOrgInvitations" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
          </div>

          <div v-else-if="orgInvitations.length === 0" class="card border-dashed p-4 text-center bg-transparent mb-4">
            <p class="text-muted small mb-0">No pending organization invitations.</p>
          </div>

          <div v-else class="card border-0 shadow-sm mb-4">
            <div class="list-group list-group-flush rounded-3">
              <div v-for="invite in orgInvitations" :key="invite.id" class="list-group-item border-0 p-4">
                <div class="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                  <div class="d-flex align-items-center gap-3 min-w-0">
                    <div class="invite-icon">
                      <i class="bi bi-building fs-5 text-primary"></i>
                    </div>
                    <div class="min-w-0">
                      <div class="fw-semibold text-dark">{{ invite.organization?.name ?? 'An organization' }}</div>
                      <div class="text-muted small">
                        Invited as
                        <span class="badge bg-light text-dark border ms-1 text-capitalize">{{ invite.role }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="d-flex gap-2 flex-shrink-0">
                    <button
                      class="btn btn-sm btn-outline-success rounded-pill px-3"
                      :disabled="respondingOrgId === invite.id"
                      @click="handleRespondOrg(invite, 'accepted')"
                    >
                      <span v-if="respondingOrgId === invite.id" class="spinner-border spinner-border-sm me-1"></span>
                      Accept
                    </button>
                    <button
                      class="btn btn-sm btn-outline-danger rounded-pill px-3"
                      :disabled="respondingOrgId === invite.id"
                      @click="handleRespondOrg(invite, 'rejected')"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Create organization modal -->
  <div v-if="showCreateOrgModal" class="modal-overlay" @click.self="closeCreateOrgModal">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
        <div class="modal-header border-0 p-4 pb-0">
          <h4 class="modal-title fw-bold">Add New Organization</h4>
          <button type="button" class="btn-close shadow-none" @click="closeCreateOrgModal"></button>
        </div>
        <div class="modal-body p-4 py-5">
          <div class="mb-2">
            <label class="form-label mb-2">Organization Name</label>
            <input
              v-model="newOrgName"
              type="text"
              class="form-control form-control-lg theme-input"
              placeholder="Enter organization name"
              autofocus
              @keyup.enter="handleCreateOrg"
            />
          </div>
          <div v-if="createOrgError" class="text-danger small mt-2 d-flex align-items-center">
            <i class="bi bi-exclamation-circle me-1"></i> {{ createOrgError }}
          </div>
        </div>
        <div class="modal-footer border-0 p-4 pt-0">
          <button
            type="button"
            class="btn btn-link text-muted text-decoration-none fw-semibold me-auto"
            @click="closeCreateOrgModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-theme-primary rounded-pill px-5 py-2 fw-bold"
            :disabled="!newOrgName.trim() || isCreatingOrg"
            @click="handleCreateOrg"
          >
            <span v-if="isCreatingOrg" class="spinner-border spinner-border-sm me-2"></span>
            {{ isCreatingOrg ? 'Creating...' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nav-tabs .nav-link {
  color: #64748b;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.6rem 1rem;
  font-weight: 500;
}

.nav-tabs .nav-link.active {
  color: var(--theme-primary, #0d6efd);
  border-bottom-color: var(--theme-primary, #0d6efd);
  background: none;
}

.nav-tabs {
  border-bottom: 1px solid #e8ecf0;
}

.card-hover {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card-hover:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1) !important;
}

.card-hover-static {
  transition: box-shadow 0.2s ease;
}

.card-hover-static:hover {
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08) !important;
}

.border-dashed {
  border: 2px dashed #e2e8f0 !important;
  border-radius: 12px;
}

.invite-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #eff6ff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.no-underline-hover:hover {
  text-decoration: none !important;
  background-color: var(--theme-primary-hover) !important;
  color: white !important;
}

.min-w-0 {
  min-width: 0;
}
</style>
