<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useMachinesStore } from '../stores/machines'
import { authService } from '../services/authService'
import type { DesktopOrganizationAccess, DesktopUserAccess, Organization } from '../types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const machinesStore = useMachinesStore()

const desktopId = route.params.desktopId as string
const accessId = route.params.accessId as string

const machine = computed(() => machinesStore.desktops.find((d) => d.id === desktopId))
const orgAccess = ref<DesktopOrganizationAccess | null>(null)
const organization = ref<Organization | null>(null)
const userAccesses = ref<DesktopUserAccess[]>([])
const isLoading = ref(false)

// Track which user is having their role saved
const savingUserId = ref<string | null>(null)
const saveError = ref<Record<string, string>>({})

const fetchData = async () => {
  if (!authStore.session) return
  isLoading.value = true
  try {
    const [accessResult, userAccessResult] = await Promise.all([
      authService.listDesktopOrgAccesses(authStore.session, desktopId),
      authService.listDesktopUserAccesses(authStore.session, desktopId),
    ])

    const accesses = accessResult.args as DesktopOrganizationAccess[]
    orgAccess.value = accesses.find((a) => a.id === accessId) ?? null
    userAccesses.value = userAccessResult.args as DesktopUserAccess[]

    if (!orgAccess.value) return

    const orgResult = await authService.getOrganization(authStore.session, orgAccess.value.organization_id)
    organization.value = orgResult.args[0] as Organization
  } catch (err) {
    console.error('Failed to load org desktop access', err)
  } finally {
    isLoading.value = false
  }
}

watch(() => authStore.session, (session) => {
  if (session) fetchData()
}, { immediate: true })

// Returns the current effective role for a member:
// their direct DesktopUserAccess role if set, otherwise the org-level default
const memberEffectiveRole = (userId: string): string => {
  const direct = userAccesses.value.find((u) => u.user_id === userId)
  return direct?.role ?? orgAccess.value?.role ?? 'member'
}

const handleRoleChange = async (userId: string, newRole: string) => {
  if (!authStore.session) return
  savingUserId.value = userId
  saveError.value = Object.fromEntries(Object.entries(saveError.value).filter(([k]) => k !== userId))
  try {
    await authService.setUserAccess(authStore.session, desktopId, userId, newRole)
    // Update local userAccesses state
    const existing = userAccesses.value.find((u) => u.user_id === userId)
    if (existing) {
      existing.role = newRole as DesktopUserAccess['role']
    } else {
      userAccesses.value.push({
        id: '',
        desktop_id: desktopId,
        user_id: userId,
        role: newRole as DesktopUserAccess['role'],
        created_at: '',
      })
    }
  } catch (err) {
    saveError.value = {
      ...saveError.value,
      [userId]: err instanceof Error ? err.message : 'Failed to update role',
    }
  } finally {
    savingUserId.value = null
  }
}

const avatarInitial = (user?: { name?: string; email?: string }) =>
  user?.name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? '?'

</script>

<template>
  <div class="container py-3 py-md-5 fade-in-up">
    <div class="row justify-content-center">
      <div class="col-lg-9">

        <!-- Back link -->
        <button
          class="btn btn-link text-decoration-none text-muted p-0 d-flex align-items-center back-link mb-3"
          @click="router.push(`/access-management/machines/${desktopId}`)"
        >
          <i class="bi bi-arrow-left-short fs-2 me-1"></i>
          <span class="fw-semibold">Back to {{ machine?.name ?? 'Machine' }}</span>
        </button>

        <!-- Loading -->
        <div v-if="isLoading" class="text-center py-5">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Loading...</span>
          </div>
        </div>

        <!-- Not found -->
        <div v-else-if="!orgAccess" class="text-center py-5 text-muted">
          <i class="bi bi-exclamation-circle display-4 d-block mb-3 opacity-25"></i>
          <p>Organization access record not found.</p>
        </div>

        <template v-else>
          <!-- Header -->
          <div class="d-flex align-items-center gap-3 mb-4">
            <div class="org-hero-icon">🏢</div>
            <div>
              <h2 class="mb-0 fw-bold">{{ organization?.name ?? orgAccess.organization_id }}</h2>
              <p class="text-muted mb-0 small">
                Set individual roles for each member on
                <strong>{{ machine?.name ?? desktopId }}</strong>
              </p>
            </div>
          </div>

          <!-- Members -->
          <div class="card border-0 shadow-sm">
            <div v-if="!organization" class="text-center py-4">
              <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
            </div>

            <div
              v-else-if="!organization.members || organization.members.length === 0"
              class="text-center text-muted py-4 small"
            >
              No members in this organization.
            </div>

            <ul v-else class="list-group list-group-flush rounded-3">
              <li
                v-for="member in organization.members"
                :key="String(member.user_id)"
                class="list-group-item border-0 px-4 py-3"
              >
                <div class="d-flex align-items-center gap-3">
                  <!-- Avatar -->
                  <div
                    class="avatar-circle"
                    :class="member.role === 'owner' ? 'avatar-owner' : 'avatar-member'"
                  >
                    {{ avatarInitial(member.user) }}
                  </div>

                  <!-- Name + email -->
                  <div class="flex-grow-1 min-w-0">
                    <div class="fw-semibold text-truncate">
                      {{ member.user?.name || member.user?.email || 'Unknown' }}
                    </div>
                    <div v-if="member.user?.name && member.user?.email" class="text-muted small text-truncate">
                      {{ member.user.email }}
                    </div>
                    <div v-if="saveError[String(member.user_id)]" class="text-danger small mt-1">
                      <i class="bi bi-exclamation-circle me-1"></i>{{ saveError[String(member.user_id)] }}
                    </div>
                  </div>

                  <!-- Role control -->
                  <div class="d-flex align-items-center gap-2 flex-shrink-0">
                    <div
                      v-if="savingUserId === String(member.user_id)"
                      class="spinner-border spinner-border-sm text-primary"
                    ></div>
                    <!-- Owner of the desktop (the machine owner) can't have their role changed -->
                    <span
                      v-if="member.user_id === organization?.owner?.id && member.role === 'owner'"
                      class="badge bg-dark rounded-pill px-3 py-2"
                    >
                      Owner
                    </span>
                    <select
                      v-else
                      class="form-select form-select-sm role-select"
                      :value="memberEffectiveRole(String(member.user_id))"
                      :disabled="savingUserId === String(member.user_id)"
                      @change="handleRoleChange(String(member.user_id), ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </div>
                </div>
              </li>
            </ul>
          </div>

        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.org-hero-icon {
  font-size: 2.4rem;
  line-height: 1;
}

.avatar-circle {
  width: 38px;
  height: 38px;
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

.role-select {
  width: auto;
  min-width: 115px;
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
</style>
