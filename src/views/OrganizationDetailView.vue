<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { authService } from '../services/authService'
import type { Organization, OrganizationInvite } from '../types'
import { ApplicationError } from 'xconn'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const orgId = route.params.id as string

// --- Detail ---
const organization = ref<Organization | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')

// --- Edit modal ---
const showEditModal = ref(false)
const editOrgName = ref('')
const isUpdating = ref(false)
const modalErrorMessage = ref('')

// --- Delete modal ---
const showDeleteModal = ref(false)
const isDeleting = ref(false)
const deleteErrorMessage = ref('')

// --- Invite member modal ---
const showInviteModal = ref(false)
const inviteEmail = ref('')
const inviteRole = ref<'admin' | 'member'>('member')
const isInviting = ref(false)
const inviteError = ref('')
const inviteSuccessToast = ref(false)

// --- Update member role ---
const updatingRoleUserId = ref<string | null>(null)

const handleMemberRoleChange = async (userId: string, newRole: string) => {
  if (!authStore.session) return
  updatingRoleUserId.value = userId
  try {
    await authService.updateOrgMemberRole(authStore.session, orgId, userId, newRole)
    if (organization.value?.members) {
      const member = organization.value.members.find((m) => String(m.user_id) === userId)
      if (member) member.role = newRole
    }
  } catch (err: unknown) {
    console.error('Failed to update member role', err)
  } finally {
    updatingRoleUserId.value = null
  }
}

// --- Remove member ---
const removingUserId = ref<string | null>(null)
const removeError = ref('')

// --- Pending invitations (outbox filtered by this org) ---
const pendingInvites = ref<OrganizationInvite[]>([])
const isLoadingInvites = ref(false)

const isOwner = computed(
  () =>
    organization.value?.owner?.id !== undefined &&
    organization.value.owner.id === authStore.user?.id,
)

const isAdminOrOwner = computed(() => {
  if (!organization.value?.members || !authStore.user) return false
  const me = organization.value.members.find((m) => String(m.user_id) === String(authStore.user?.id))
  return me?.role === 'admin' || me?.role === 'owner'
})

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
    errorMessage.value = err instanceof Error ? err.message : 'Failed to load organization'
  } finally {
    isLoading.value = false
  }
}

const fetchPendingInvites = async () => {
  if (!authStore.session) return
  isLoadingInvites.value = true
  try {
    const result = await authService.listOrgInvitesOutbox(authStore.session)
    pendingInvites.value = (result.args as OrganizationInvite[]).filter(
      (inv) => inv.organization_id === orgId,
    )
  } catch (err) {
    console.error('Failed to fetch pending invites', err)
  } finally {
    isLoadingInvites.value = false
  }
}

watch(
  () => authStore.session,
  (newSession) => {
    if (newSession && !organization.value) {
      fetchOrganizationDetails()
    }
  },
  { immediate: true },
)

watch([() => authStore.session, isAdminOrOwner], ([session, adminOrOwner]) => {
  if (session && adminOrOwner) fetchPendingInvites()
})

onMounted(() => {
  if (authStore.session) fetchOrganizationDetails()
})

// --- Edit ---
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
  if (
    !organization.value ||
    !editOrgName.value.trim() ||
    editOrgName.value === organization.value.name
  ) {
    handleCancelEdit()
    return
  }
  isUpdating.value = true
  modalErrorMessage.value = ''
  try {
    if (!authStore.session) throw new Error('No active session')
    await authService.updateOrganization(authStore.session, orgId, editOrgName.value)
    if (organization.value) organization.value.name = editOrgName.value
    handleCancelEdit()
  } catch (err: unknown) {
    modalErrorMessage.value = err instanceof Error ? err.message : 'Failed to update organization'
  } finally {
    isUpdating.value = false
  }
}

// --- Delete ---
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
    router.push('/access-management')
  } catch (err: unknown) {
    deleteErrorMessage.value = err instanceof Error ? err.message : 'Failed to delete organization'
  } finally {
    isDeleting.value = false
  }
}

const parseErrorArgs = (args: unknown): string => {
  const str = String(args)
  try {
    const parsed = JSON.parse(str)
    if (Array.isArray(parsed)) return parsed.map((a: { msg?: string }) => a.msg ?? String(a)).join('; ')
  } catch {}
  return str
}

// --- Invite member ---
const openInviteModal = () => {
  inviteEmail.value = ''
  inviteRole.value = 'member'
  inviteError.value = ''
  showInviteModal.value = true
}

const closeInviteModal = () => {
  showInviteModal.value = false
}

const handleInviteUser = async () => {
  if (!authStore.session || !inviteEmail.value.trim()) return
  isInviting.value = true
  inviteError.value = ''
  try {
    await authService.inviteUserToOrganization(
      authStore.session,
      orgId,
      inviteEmail.value,
      inviteRole.value,
    )
    closeInviteModal()
    await fetchPendingInvites()
    inviteSuccessToast.value = true
    setTimeout(() => { inviteSuccessToast.value = false }, 3000)
  } catch (err: unknown) {
    if (err instanceof ApplicationError) {
      inviteError.value = parseErrorArgs(err.args)
    } else {
      inviteError.value = 'Failed to send invitation'
    }
  } finally {
    isInviting.value = false
  }
}

const handleInviteEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeInviteModal() }
watch(showInviteModal, (open) => {
  if (open) document.addEventListener('keydown', handleInviteEsc)
  else document.removeEventListener('keydown', handleInviteEsc)
})

const handleEditEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCancelEdit() }
watch(showEditModal, (open) => {
  if (open) document.addEventListener('keydown', handleEditEsc)
  else document.removeEventListener('keydown', handleEditEsc)
})

const handleDeleteEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') handleCancelDelete() }
watch(showDeleteModal, (open) => {
  if (open) document.addEventListener('keydown', handleDeleteEsc)
  else document.removeEventListener('keydown', handleDeleteEsc)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleInviteEsc)
  document.removeEventListener('keydown', handleEditEsc)
  document.removeEventListener('keydown', handleDeleteEsc)
})

// --- Cancel invite ---
const cancelingInviteId = ref<string | null>(null)

const handleCancelInvite = async (inviteId: string) => {
  if (!authStore.session) return
  cancelingInviteId.value = inviteId
  try {
    await authService.cancelOrgInvite(authStore.session, inviteId)
    pendingInvites.value = pendingInvites.value.filter((inv) => inv.id !== inviteId)
  } catch {
    await fetchPendingInvites()
  } finally {
    cancelingInviteId.value = null
  }
}

// --- Remove member ---
const handleRemoveMember = async (userId: string) => {
  if (!authStore.session) return
  removingUserId.value = userId
  removeError.value = ''
  try {
    await authService.removeOrgMember(authStore.session, orgId, userId)
    if (organization.value?.members) {
      organization.value.members = organization.value.members.filter(
        (m) => String(m.user_id) !== userId,
      )
    }
  } catch (err: unknown) {
    removeError.value = err instanceof Error ? err.message : 'Failed to remove member'
  } finally {
    removingUserId.value = null
  }
}
</script>

<template>
  <div class="container py-3 py-md-5 fade-in-up">
    <div v-if="inviteSuccessToast" class="alert alert-success d-flex align-items-center py-2 small position-fixed top-0 start-50 translate-middle-x mt-3 shadow" style="z-index:1100;min-width:260px" role="alert">
      <i class="bi bi-check-circle-fill me-2"></i> Invitation sent successfully!
    </div>
    <!-- Navigation -->
    <div class="row mb-4 justify-content-center">
      <div class="col-lg-10">
        <router-link
          to="/access-management"
          class="btn btn-link text-decoration-none text-muted p-0 d-flex align-items-center back-link mb-3"
        >
          <i class="bi bi-arrow-left-short fs-2 me-1"></i>
          <span class="fw-semibold">Back to Access Management</span>
        </router-link>
        <nav aria-label="breadcrumb">
          <ol class="breadcrumb mb-0">
            <li class="breadcrumb-item">
              <router-link
                to="/access-management"
                class="text-decoration-none text-primary opacity-75"
              >
                Access Management
              </router-link>
            </li>
            <li class="breadcrumb-item active" aria-current="page">Organization</li>
          </ol>
        </nav>
      </div>
    </div>

    <!-- Header -->
    <div v-if="organization" class="row mb-5 justify-content-center">
      <div class="col-lg-10">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <h1 class="display-5 fw-bold mb-0">{{ organization.name }}</h1>
            <p class="text-muted lead mb-0">Organization Management</p>
          </div>
          <div v-if="isOwner" class="d-flex gap-2 flex-shrink-0">
            <button
              @click="handleOpenEditModal"
              class="btn btn-primary rounded-pill px-3 px-md-4 py-2 fw-bold shadow-sm"
            >
              <i class="bi bi-pencil-square me-1 me-md-2"></i
              ><span class="d-none d-sm-inline">Edit</span>
            </button>
            <button
              @click="handleOpenDeleteModal"
              class="btn btn-theme-danger rounded-pill px-3 px-md-4 py-2 fw-bold shadow-sm"
            >
              <i class="bi bi-trash me-1 me-md-2"></i><span class="d-none d-sm-inline">Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="errorMessage" class="row justify-content-center">
      <div class="col-lg-10">
        <div class="alert alert-danger d-flex align-items-center" role="alert">
          <i class="bi bi-exclamation-triangle-fill me-2"></i>
          <div>{{ errorMessage }}</div>
        </div>
        <button @click="router.push('/access-management')" class="btn btn-outline-primary mt-3">
          <i class="bi bi-arrow-left me-2"></i> Back to Access Management
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !organization" class="row justify-content-center">
      <div class="col-lg-10 text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
    </div>

    <div v-if="organization" class="row justify-content-center g-4">
      <div class="col-lg-10">
        <!-- Remove member error -->
        <div
          v-if="removeError"
          class="alert alert-danger d-flex align-items-center mb-3 py-2"
          role="alert"
        >
          <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ removeError }}
        </div>

        <!-- Members section -->
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h4 class="mb-0 d-flex align-items-center">
            <span class="badge bg-dark me-3 p-2"><i class="bi bi-people"></i></span>
            Members
          </h4>
          <button
            v-if="isAdminOrOwner"
            class="btn btn-sm btn-outline-primary rounded-pill px-3"
            @click="openInviteModal"
          >
            <i class="bi bi-person-plus me-1"></i> Invite member
          </button>
        </div>

        <div class="card border-0 shadow-sm mb-4">
          <div class="list-group list-group-flush rounded-3">
            <div
              v-for="member in organization.members"
              :key="member.user_id"
              class="list-group-item border-0 p-3"
            >
              <div class="d-flex align-items-center justify-content-between gap-3">
                <div class="d-flex align-items-center gap-3 min-w-0">
                  <div
                    class="avatar-circle"
                    :class="member.role === 'owner' ? 'avatar-owner' : 'avatar-member'"
                  >
                    {{
                      member.user.name?.charAt(0)?.toUpperCase() ||
                      member.user.email?.charAt(0)?.toUpperCase() ||
                      '?'
                    }}
                  </div>
                  <div class="min-w-0">
                    <div class="fw-semibold text-truncate">{{ member.user.name || 'Unknown' }}</div>
                    <div class="text-muted small text-truncate">
                      {{ member.user.email || 'No email' }}
                    </div>
                  </div>
                </div>
                <div class="d-flex align-items-center gap-2 flex-shrink-0">
                  <div
                    v-if="updatingRoleUserId === String(member.user_id)"
                    class="spinner-border spinner-border-sm text-primary"
                  ></div>
                  <span
                    v-if="member.role === 'owner'"
                    class="badge bg-dark text-capitalize px-3 py-2"
                    >Owner</span
                  >
                  <select
                    v-else-if="isOwner"
                    class="form-select form-select-sm role-select"
                    :value="member.role"
                    :disabled="updatingRoleUserId === String(member.user_id)"
                    @change="
                      handleMemberRoleChange(
                        String(member.user_id),
                        ($event.target as HTMLSelectElement).value,
                      )
                    "
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                  <span v-else class="badge bg-light text-dark border text-capitalize">{{
                    member.role
                  }}</span>
                  <button
                    v-if="isOwner && member.role !== 'owner'"
                    class="btn btn-sm btn-outline-danger rounded-pill px-2 py-1"
                    :disabled="removingUserId === String(member.user_id)"
                    style="font-size: 0.75rem"
                    @click="handleRemoveMember(String(member.user_id))"
                  >
                    <span
                      v-if="removingUserId === String(member.user_id)"
                      class="spinner-border spinner-border-sm"
                    ></span>
                    <i v-else class="bi bi-person-dash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pending Invitations section (admin/owner only) -->
        <template v-if="isAdminOrOwner">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h4 class="mb-0 d-flex align-items-center">
              <span class="badge bg-secondary me-3 p-2"><i class="bi bi-envelope"></i></span>
              Pending Invitations
            </h4>
          </div>

          <div v-if="isLoadingInvites" class="text-center py-3">
            <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
          </div>

          <div
            v-else-if="pendingInvites.length === 0"
            class="card border-dashed p-4 text-center bg-transparent mb-4"
          >
            <p class="text-muted small mb-0">No pending invitations.</p>
          </div>

          <div v-else class="card border-0 shadow-sm mb-4">
            <div class="list-group list-group-flush rounded-3">
              <div
                v-for="invite in pendingInvites"
                :key="invite.id"
                class="list-group-item border-0 p-3"
              >
                <div class="d-flex align-items-center justify-content-between gap-3">
                  <div class="d-flex align-items-center gap-3 min-w-0">
                    <div class="avatar-circle avatar-member">
                      {{ invite.invitee?.email?.charAt(0)?.toUpperCase() ?? '?' }}
                    </div>
                    <div class="min-w-0">
                      <div class="fw-semibold text-truncate">
                        {{ invite.invitee?.email ?? 'Unknown' }}
                      </div>
                      <div class="text-muted small">
                        Invited as
                        <span class="badge bg-light text-dark border ms-1 text-capitalize">{{
                          invite.role
                        }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="d-flex align-items-center gap-2 flex-shrink-0">
                    <span class="badge bg-warning-subtle text-warning border border-warning-subtle">
                      Pending
                    </span>
                    <button
                      class="btn btn-sm btn-outline-danger rounded-pill px-2 py-1"
                      style="font-size: 0.75rem"
                      :disabled="cancelingInviteId === invite.id"
                      @click="handleCancelInvite(invite.id)"
                    >
                      <span v-if="cancelingInviteId === invite.id" class="spinner-border spinner-border-sm"></span>
                      <i v-else class="bi bi-x-lg"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ── Invite member modal ── -->
    <div v-if="showInviteModal" class="modal-overlay" @click.self="closeInviteModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
          <div class="modal-header border-0 p-4 pb-0">
            <h4 class="modal-title fw-bold">Invite a member</h4>
            <button type="button" class="btn-close shadow-none" @click="closeInviteModal"></button>
          </div>
          <div class="modal-body p-4">
            <div class="mb-3">
              <label class="form-label fw-semibold small">Email address</label>
              <input
                v-model="inviteEmail"
                type="email"
                class="form-control theme-input"
                placeholder="user@example.com"
                autofocus
                @keyup.enter="handleInviteUser"
              />
            </div>
            <div class="mb-3">
              <label class="form-label fw-semibold small">Role</label>
              <div class="d-flex gap-3">
                <label class="role-option flex-fill" :class="{ selected: inviteRole === 'member' }">
                  <input type="radio" v-model="inviteRole" value="member" class="visually-hidden" />
                  <div class="p-3 rounded-3 border text-center cursor-pointer">
                    <i class="bi bi-person fs-4 d-block mb-1 text-muted"></i>
                    <div class="fw-semibold small">Member</div>
                    <div class="text-muted" style="font-size: 0.75rem">Standard access</div>
                  </div>
                </label>
                <label class="role-option flex-fill" :class="{ selected: inviteRole === 'admin' }">
                  <input type="radio" v-model="inviteRole" value="admin" class="visually-hidden" />
                  <div class="p-3 rounded-3 border text-center cursor-pointer">
                    <i class="bi bi-shield-check fs-4 d-block mb-1 text-muted"></i>
                    <div class="fw-semibold small">Admin</div>
                    <div class="text-muted" style="font-size: 0.75rem">Manage access</div>
                  </div>
                </label>
              </div>
            </div>
            <div v-if="inviteError" class="alert alert-danger d-flex align-items-center justify-content-between py-2 small mb-0" role="alert">
              <span><i class="bi bi-exclamation-circle-fill me-2"></i>{{ inviteError }}</span>
              <button type="button" class="btn-close btn-sm ms-2" @click="inviteError = ''" aria-label="Close"></button>
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button
              type="button"
              class="btn btn-link text-muted text-decoration-none fw-semibold me-auto"
              @click="closeInviteModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-theme-primary rounded-pill px-5 py-2 fw-bold"
              :disabled="!inviteEmail.trim() || isInviting"
              @click="handleInviteUser"
            >
              <span v-if="isInviting" class="spinner-border spinner-border-sm me-2"></span>
              {{ isInviting ? 'Sending...' : 'Send invitation' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Edit modal ── -->
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
              />
            </div>
            <div v-if="modalErrorMessage" class="text-danger small mt-2 d-flex align-items-center">
              <i class="bi bi-exclamation-circle me-1"></i> {{ modalErrorMessage }}
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button
              type="button"
              class="btn btn-link text-muted text-decoration-none fw-semibold me-auto"
              @click="handleCancelEdit"
            >
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

    <!-- ── Delete modal ── -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="handleCancelDelete">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content card shadow-lg border-0 glass-modal fade-in-up">
          <div class="modal-header border-0 p-4 pb-0">
            <h4 class="modal-title fw-bold text-danger">Delete Organization</h4>
            <button
              type="button"
              class="btn-close shadow-none"
              @click="handleCancelDelete"
            ></button>
          </div>
          <div class="modal-body p-4 py-5 text-center">
            <div class="mb-4">
              <i class="bi bi-exclamation-triangle-fill text-danger display-1 opacity-25"></i>
            </div>
            <h5 class="fw-bold mb-3">Are you absolutely sure?</h5>
            <p v-if="organization" class="text-muted mb-0">
              You are about to delete <strong>{{ organization.name }}</strong
              >. This action cannot be undone.
            </p>
            <div
              v-if="deleteErrorMessage"
              class="text-danger small mt-4 d-flex align-items-center justify-content-center"
            >
              <i class="bi bi-exclamation-circle me-1"></i> {{ deleteErrorMessage }}
            </div>
          </div>
          <div class="modal-footer border-0 p-4 pt-0">
            <button
              type="button"
              class="btn btn-link text-muted text-decoration-none fw-semibold me-auto"
              @click="handleCancelDelete"
            >
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
  content: '›';
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

.avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.9rem;
  flex-shrink: 0;
}

.avatar-owner {
  background: #1e293b;
  color: #fff;
}

.avatar-member {
  background: #e2e8f0;
  color: #475569;
}

.border-dashed {
  border: 2px dashed #e2e8f0 !important;
  border-radius: 12px;
}

.role-option .border {
  border-color: #e2e8f0 !important;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
  cursor: pointer;
}

.role-option.selected .border {
  border-color: var(--theme-primary, #0d6efd) !important;
  background: #eff6ff;
}

.role-option.selected .text-muted {
  color: var(--theme-primary, #0d6efd) !important;
}

.role-select {
  width: auto;
  min-width: 105px;
  font-size: 0.85rem;
  border-radius: 8px;
  border-color: #e2e8f0;
  cursor: pointer;
}

.role-select:focus {
  border-color: var(--theme-primary, #0d6efd);
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
}

.min-w-0 {
  min-width: 0;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
