<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ApplicationError, type Session } from 'xconn'

import { useAuthStore } from '@/stores/auth'
import type { FileBrowseResult, FileEntry } from '@/types'
import {
  createX25519KeyPair,
  deriveSessionKeys,
  encryptPayload,
  decryptPayload,
  type EncryptionKeys,
} from '@/utils/encryption'

const procedureKeyExchange = 'io.xconn.deskconn.deskconnd.key.exchange'
const procedureFileBrowse = 'io.xconn.deskconn.deskconnd.file.browse'
const outsideHomeMessage = 'Access denied. You can only browse files inside the home directory.'

const props = defineProps<{
  realm: string
  desktopName?: string
}>()

const authStore = useAuthStore()

const session = ref<Session | null>(null)
const encryptionKeys = ref<EncryptionKeys | null>(null)
const isConnecting = ref(true)
const isLoading = ref(false)
const errorMessage = ref('')
const currentBrowse = ref<FileBrowseResult | null>(null)
const selectedEntry = ref<FileEntry | null>(null)
const pathInput = ref('')
const showHiddenFiles = ref(false)

const detailsTarget = computed(() => {
  if (selectedEntry.value) {
    return {
      name: selectedEntry.value.name,
      path: selectedEntry.value.path,
      type: selectedEntry.value.type,
      mode: selectedEntry.value.mode,
      size: selectedEntry.value.size,
      mod_time: selectedEntry.value.mod_time,
      is_dir: selectedEntry.value.is_dir,
      is_symlink: selectedEntry.value.is_symlink,
      link_target: selectedEntry.value.link_target,
    }
  }

  return currentBrowse.value
})

const breadcrumbSegments = computed(() => {
  const browse = currentBrowse.value
  if (!browse) return []

  const homePath = normalizePathValue(browse.home_path)
  const currentPath = normalizePathValue(browse.path)

  if (currentPath === homePath) {
    return [{ label: 'Home', path: homePath }]
  }

  const relativePath = currentPath.startsWith(homePath + '/')
    ? currentPath.slice(homePath.length + 1)
    : ''

  if (!relativePath) {
    return [{ label: homePath, path: currentPath }]
  }

  const parts = relativePath.split('/').filter(Boolean)
  const segments = [{ label: 'Home', path: homePath }]
  let runningPath = homePath

  for (const part of parts) {
    runningPath = `${runningPath}/${part}`
    segments.push({ label: part, path: runningPath })
  }

  return segments
})

const canGoUp = computed(() => {
  if (!currentBrowse.value) return false

  return (
    Boolean(currentBrowse.value.parent_path) &&
    normalizePathValue(currentBrowse.value.path) !==
      normalizePathValue(currentBrowse.value.home_path)
  )
})

const visibleEntries = computed(() => {
  const entries = currentBrowse.value?.entries || []
  if (showHiddenFiles.value) return entries

  return entries.filter((entry) => !entry.hidden && !entry.name.startsWith('.'))
})

function normalizePathValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in source) {
      return source[key]
    }
  }

  return undefined
}

function getStringValue(source: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(source, ...keys)
  return typeof value === 'string' ? value : ''
}

function getDateValue(source: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(source, ...keys)
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function getBooleanValue(source: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(source, ...keys)
  return typeof value === 'boolean' ? value : false
}

function getNumberValue(source: Record<string, unknown>, ...keys: string[]) {
  const value = getValue(source, ...keys)
  return typeof value === 'number' ? value : 0
}

function parseFileEntry(raw: unknown): FileEntry {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  return {
    name: getStringValue(source, 'name', 'Name'),
    path: getStringValue(source, 'path', 'Path'),
    type: getStringValue(source, 'type', 'Type'),
    mode: getStringValue(source, 'mode', 'Mode'),
    size: getNumberValue(source, 'size', 'Size'),
    hidden: getBooleanValue(source, 'hidden', 'Hidden'),
    mod_time: getStringValue(source, 'mod_time', 'ModTime'),
    is_dir: getBooleanValue(source, 'is_dir', 'IsDir'),
    is_symlink: getBooleanValue(source, 'is_symlink', 'IsSymlink'),
    link_target: getStringValue(source, 'link_target', 'LinkTarget'),
  }
}

function parseBrowseResult(raw: unknown): FileBrowseResult {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawEntries = getValue(source, 'entries', 'Entries')
  const entries = Array.isArray(rawEntries) ? rawEntries.map(parseFileEntry) : []

  return {
    path: getStringValue(source, 'path', 'Path'),
    home_path: getStringValue(source, 'home_path', 'HomePath'),
    parent_path: getStringValue(source, 'parent_path', 'ParentPath'),
    type: getStringValue(source, 'type', 'Type'),
    mode: getStringValue(source, 'mode', 'Mode'),
    size: getNumberValue(source, 'size', 'Size'),
    mod_time: getDateValue(source, 'mod_time'),
    is_dir: getBooleanValue(source, 'is_dir', 'IsDir'),
    is_symlink: getBooleanValue(source, 'is_symlink', 'IsSymlink'),
    link_target: getStringValue(source, 'link_target', 'LinkTarget'),
    entries,
  }
}

function formatError(error: unknown) {
  const fallback = 'Desktop is offline.'
  const invalidPathMessage = 'Invalid path.'

  if (error instanceof ApplicationError) {
    const message = (error.message || '').toLowerCase()
    if (message.includes('relative path escapes home')) {
      return outsideHomeMessage
    }
    if (
      message.includes('no such file') ||
      message.includes('not exist') ||
      message.includes('invalid path') ||
      message.includes('invalid argument')
    ) {
      return invalidPathMessage
    }
    if (
      message.includes('procedure') ||
      message.includes('offline') ||
      message.includes('not registered') ||
      message.includes('network') ||
      message.includes('transport')
    ) {
      return fallback
    }

    return error.message || fallback
  }
  if (error instanceof Error) {
    const message = error.message || ''
    const lowered = message.toLowerCase()
    if (
      lowered.includes('relative path escapes home') ||
      lowered.includes('outside the home directory')
    ) {
      return outsideHomeMessage
    }
    if (
      lowered.includes('no such file') ||
      lowered.includes('not exist') ||
      lowered.includes('invalid path') ||
      lowered.includes('invalid argument')
    ) {
      return invalidPathMessage
    }
    if (
      lowered.includes('procedure') ||
      lowered.includes('offline') ||
      lowered.includes('not registered') ||
      lowered.includes('network') ||
      lowered.includes('transport')
    ) {
      return fallback
    }

    return message
  }
  return fallback
}

function formatDate(value?: string) {
  if (!value) return 'Unknown'

  const numericValue = Number(value)
  const parsedValue =
    Number.isFinite(numericValue) && value.trim() !== ''
      ? numericValue < 1e12
        ? numericValue * 1000
        : numericValue
      : value

  const date = new Date(parsedValue)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatSize(size?: number) {
  if (typeof size !== 'number') return '-'
  if (size < 1024) return `${size} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = -1

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function iconClassForEntry(entry: FileEntry) {
  if (entry.is_dir) return 'bi-folder-fill'
  if (entry.is_symlink) return 'bi-signpost-split-fill'

  const lowered = entry.name.toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lowered)) return 'bi-image-fill'
  if (/\.(zip|tar|gz|xz|7z)$/.test(lowered)) return 'bi-file-earmark-zip-fill'
  if (/\.(json|yaml|yml|toml|xml|ini|conf|env)$/.test(lowered)) return 'bi-filetype-yml'
  if (/\.(md|txt|log)$/.test(lowered)) return 'bi-file-earmark-text-fill'

  return 'bi-file-earmark-fill'
}

function normalizeComparablePath(path: string) {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function isPathWithinHome(path: string, homePath: string) {
  const normalizedPath = normalizeComparablePath(path)
  const normalizedHome = normalizeComparablePath(homePath)

  return normalizedPath === normalizedHome || normalizedPath.startsWith(`${normalizedHome}/`)
}

async function disconnectDesktopSession() {
  const currentSession = session.value
  session.value = null

  if (!currentSession) return

  try {
    await currentSession.leave()
  } catch (error) {
    console.error(error)
  }
}

function resetExplorerState() {
  currentBrowse.value = null
  selectedEntry.value = null
  pathInput.value = ''
  errorMessage.value = ''
  isLoading.value = false
  encryptionKeys.value = null
}

async function performKeyExchange() {
  if (!session.value) return false

  const { publicKey, privateKey } = createX25519KeyPair()
  const result = await session.value.call(procedureKeyExchange, [publicKey])
  const serverPublicKey = result.args?.[0]

  if (!(serverPublicKey instanceof Uint8Array) && !Array.isArray(serverPublicKey)) {
    throw new Error('Invalid server public key received during key exchange')
  }

  const serverKeyBytes =
    serverPublicKey instanceof Uint8Array
      ? serverPublicKey
      : new Uint8Array(serverPublicKey as number[])

  encryptionKeys.value = await deriveSessionKeys(privateKey, serverKeyBytes)
  return true
}

async function loadPath(path = '') {
  if (!session.value) return

  isLoading.value = true
  errorMessage.value = ''

  const requestedPath = path.trim()
  const homePath = normalizePathValue(currentBrowse.value?.home_path)
  if (
    requestedPath &&
    requestedPath.startsWith('/') &&
    homePath &&
    !isPathWithinHome(requestedPath, homePath)
  ) {
    errorMessage.value = outsideHomeMessage
    isLoading.value = false
    return
  }

  try {
    const keys = encryptionKeys.value
    if (!keys) {
      throw new Error('Encryption keys not established. Reconnect and try again.')
    }

    const pathBytes = new TextEncoder().encode(requestedPath)
    const encryptedPath = encryptPayload(pathBytes, keys.encryptKey)

    const result = await session.value.call(procedureFileBrowse, [encryptedPath])

    const encryptedResult = result.args?.[0]
    if (!encryptedResult) {
      throw new Error('Empty response from remote file browser')
    }

    const encryptedBytes =
      encryptedResult instanceof Uint8Array
        ? encryptedResult
        : new Uint8Array(encryptedResult as number[])

    const decrypted = decryptPayload(encryptedBytes, keys.decryptKey)
    const parsed = JSON.parse(new TextDecoder().decode(decrypted))
    const browse = parseBrowseResult(parsed)

    if (!browse || !browse.path) {
      throw new Error('Empty response from remote file browser')
    }

    if (!isPathWithinHome(browse.path, browse.home_path)) {
      throw new Error('Outside the home directory')
    }

    currentBrowse.value = browse
    pathInput.value = browse.path
    selectedEntry.value = null
  } catch (error) {
    errorMessage.value = formatError(error)
  } finally {
    isLoading.value = false
  }
}

async function connectDesktopSession() {
  isConnecting.value = true
  errorMessage.value = ''

  try {
    session.value = (await authStore.shell(props.realm)) as Session | null
  } catch (error) {
    errorMessage.value = formatError(error)
    session.value = null
  } finally {
    isConnecting.value = false
  }
}

async function initializeExplorer() {
  resetExplorerState()
  await disconnectDesktopSession()
  await connectDesktopSession()

  if (!session.value) return

  try {
    await performKeyExchange()
  } catch (error) {
    errorMessage.value = formatError(error)
    return
  }

  await loadPath('')
}

async function goUp() {
  if (!currentBrowse.value?.parent_path || !canGoUp.value) return
  await loadPath(currentBrowse.value.parent_path)
}

async function refreshCurrentPath() {
  await loadPath(currentBrowse.value?.path || '')
}

function selectEntry(entry: FileEntry) {
  selectedEntry.value = entry
}

async function openEntry(entry: FileEntry) {
  if (entry.is_dir) {
    await loadPath(entry.path)
    return
  }

  selectEntry(entry)
}

async function submitPath() {
  await loadPath(pathInput.value.trim())
}

watch(showHiddenFiles, (enabled) => {
  if (enabled) return
  if (selectedEntry.value?.hidden || selectedEntry.value?.name.startsWith('.')) {
    selectedEntry.value = null
  }
})

watch(
  () => props.realm,
  async () => {
    await initializeExplorer()
  },
)

onMounted(async () => {
  await initializeExplorer()
})

onUnmounted(async () => {
  await disconnectDesktopSession()
})
</script>

<template>
  <div class="embedded-explorer">
    <div class="explorer-shell">
      <header class="explorer-header">
        <div class="header-actions">
          <button
            class="btn btn-dark rounded-pill px-3"
            @click="refreshCurrentPath"
            :disabled="isLoading || isConnecting"
          >
            <i class="bi bi-arrow-clockwise"></i><span class="btn-text ms-2">Refresh</span>
          </button>
        </div>
      </header>

      <section class="toolbar-card">
        <div class="path-toolbar">
          <button
            class="tool-btn"
            @click="goUp"
            :disabled="!canGoUp || isLoading || isConnecting"
            title="Go up"
          >
            <i class="bi bi-arrow-left"></i>
          </button>

          <div class="breadcrumb-strip" v-if="breadcrumbSegments.length > 0">
            <template v-for="(segment, index) in breadcrumbSegments" :key="segment.path">
              <button
                class="breadcrumb-chip"
                :class="{ 'breadcrumb-chip-current': index === breadcrumbSegments.length - 1 }"
                @click="() => loadPath(segment.path)"
              >
                {{ segment.label }}
              </button>
              <span v-if="index < breadcrumbSegments.length - 1" class="breadcrumb-sep">/</span>
            </template>
          </div>

          <form class="path-input-wrap" @submit.prevent="submitPath">
            <i class="bi bi-folder2-open path-icon"></i>
            <input
              v-model="pathInput"
              type="text"
              class="path-input"
              placeholder="Enter a path"
              :disabled="isConnecting"
            />
          </form>
        </div>

        <div v-if="errorMessage" class="alert alert-danger mb-0 mt-3">
          <i class="bi bi-exclamation-octagon me-2"></i>{{ errorMessage }}
        </div>
      </section>

      <div v-if="isConnecting" class="state-card">
        <div class="spinner-border text-warning mb-3" role="status">
          <span class="visually-hidden">Connecting...</span>
        </div>
        <h3 class="h5 mb-2">Connecting to desktop</h3>
        <p class="text-muted mb-0">
          Trying WebRTC first, then falling back to the direct device session.
        </p>
      </div>

      <div v-else class="explorer-grid">
        <section class="browser-card">
          <div class="browser-card-header">
            <div>
              <p class="section-label mb-1">Current Location</p>
              <h3 class="mb-0 current-path">{{ currentBrowse?.path || 'Home' }}</h3>
            </div>

            <div v-if="currentBrowse" class="browser-header-actions">
              <label v-if="currentBrowse.is_dir" class="hidden-toggle">
                <input v-model="showHiddenFiles" type="checkbox" />
                <span>Show hidden files</span>
              </label>
              <span class="entry-count">
                {{ currentBrowse.is_dir ? `${visibleEntries.length} entries` : currentBrowse.type }}
              </span>
            </div>
          </div>

          <!-- Initial load spinner: only when no content exists yet -->
          <div v-if="isLoading && !currentBrowse" class="browser-state">
            <div class="spinner-border mb-3" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mb-0">Loading remote path…</p>
          </div>

          <!-- Entry list: stays mounted, dims during in-folder navigation -->
          <div
            v-else-if="currentBrowse && currentBrowse.is_dir && visibleEntries.length > 0"
            class="entry-list"
            :class="{ 'entry-list-loading': isLoading }"
          >
            <button
              v-for="entry in visibleEntries"
              :key="entry.path"
              class="entry-row"
              :class="{ active: selectedEntry?.path === entry.path }"
              @click="openEntry(entry)"
            >
              <div class="entry-main">
                <span class="entry-icon">
                  <i class="bi" :class="iconClassForEntry(entry)"></i>
                </span>
                <div>
                  <div class="entry-name">{{ entry.name }}</div>
                  <div class="entry-meta">
                    <span>{{ entry.type }}</span>
                  </div>
                </div>
              </div>

              <div class="entry-side">
                <span class="entry-size">{{
                  entry.is_dir ? 'Folder' : formatSize(entry.size)
                }}</span>
                <button class="open-btn" @click.stop="openEntry(entry)">
                  <i class="bi" :class="entry.is_dir ? 'bi-chevron-right' : 'bi-info-circle'"></i>
                </button>
              </div>
            </button>
          </div>

          <div v-else-if="currentBrowse && currentBrowse.is_dir" class="browser-state">
            <i class="bi bi-folder2-open display-6 mb-3"></i>
            <p class="mb-0">
              {{
                (currentBrowse.entries?.length || 0) > 0
                  ? 'This folder only contains hidden files.'
                  : 'This folder is empty.'
              }}
            </p>
          </div>

          <div v-else-if="currentBrowse" class="browser-state">
            <i class="bi bi-file-earmark-text display-6 mb-3"></i>
            <p class="mb-0">You are viewing file properties.</p>
          </div>
        </section>

        <aside class="details-card">
          <div class="details-card-header">
            <p class="section-label mb-1">Properties</p>
            <h3 class="h5 mb-0 details-title">{{ detailsTarget?.path || 'No item selected' }}</h3>
          </div>

          <div v-if="detailsTarget" class="details-body">
            <div class="detail-row">
              <span>Name</span>
              <strong>{{
                'name' in detailsTarget && detailsTarget.name
                  ? detailsTarget.name
                  : currentBrowse?.path?.split('/').pop() || 'Home'
              }}</strong>
            </div>
            <div class="detail-row">
              <span>Type</span>
              <strong>{{ detailsTarget.type }}</strong>
            </div>
            <div class="detail-row">
              <span>Mode</span>
              <strong>{{ detailsTarget.mode }}</strong>
            </div>
            <div class="detail-row">
              <span>Size</span>
              <strong>{{ formatSize(detailsTarget.size) }}</strong>
            </div>
            <div class="detail-row">
              <span>Modified</span>
              <strong>{{ formatDate(detailsTarget.mod_time) }}</strong>
            </div>
            <div class="detail-row">
              <span>Directory</span>
              <strong>{{ detailsTarget.is_dir ? 'Yes' : 'No' }}</strong>
            </div>
            <div class="detail-row">
              <span>Symlink</span>
              <strong>{{ detailsTarget.is_symlink ? 'Yes' : 'No' }}</strong>
            </div>
            <div v-if="detailsTarget.link_target" class="detail-row">
              <span>Link Target</span>
              <strong class="path-detail">{{ detailsTarget.link_target }}</strong>
            </div>
          </div>

          <div v-else class="details-empty">
            <i class="bi bi-info-circle display-6 mb-3"></i>
            <p class="mb-0">Pick a file or folder to inspect its properties.</p>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.embedded-explorer {
  background: transparent;
  padding: 0;
}

.explorer-shell {
  max-width: 1440px;
  margin: 0 auto;
}

.explorer-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1.5rem;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.toolbar-card,
.browser-card,
.details-card,
.state-card {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 16px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.05),
    0 10px 10px -5px rgba(0, 0, 0, 0.01);
  backdrop-filter: blur(12px);
}

.toolbar-card {
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.hidden-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.8rem;
  border-radius: 999px;
  background: #eef3f7;
  color: #506071;
  font-size: 0.85rem;
  font-weight: 700;
  white-space: nowrap;
}

.hidden-toggle input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--theme-primary);
}

.path-toolbar {
  display: grid;
  grid-template-columns: auto 1fr minmax(260px, 420px);
  gap: 0.75rem;
  align-items: center;
}

.tool-btn {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 8px;
  background: #2c2e33;
  color: #fff;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tool-btn:disabled {
  opacity: 0.5;
}

.breadcrumb-strip {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  overflow-x: auto;
  padding-bottom: 0.1rem;
  min-width: 0;
}

.breadcrumb-sep {
  color: #94a3b8;
  font-size: 0.85rem;
  flex-shrink: 0;
  user-select: none;
  padding: 0 0.1rem;
}

.breadcrumb-chip {
  border: 0;
  border-radius: 6px;
  padding: 0.3rem 0.4rem;
  background: transparent;
  color: #475569;
  font-weight: 600;
  font-size: 1rem;
  white-space: nowrap;
}

.breadcrumb-chip:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.breadcrumb-chip-current {
  color: #0f172a;
  font-weight: 700;
  cursor: default;
}

.breadcrumb-chip-current:hover {
  background: transparent;
  color: #0f172a;
}

.path-input-wrap {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 1rem;
  border-radius: 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  min-height: 52px;
}

.path-icon {
  color: #64748b;
}

.path-input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #21313f;
}

.state-card,
.browser-state,
.details-empty {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  flex-direction: column;
  color: #617182;
  padding: 2rem;
}

.explorer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr);
  gap: 1.5rem;
}

.browser-card,
.details-card {
  padding: 1.25rem;
}

.browser-card-header,
.details-card-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.browser-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.details-card-header {
  min-width: 0;
  flex-direction: column;
}

.details-title {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.current-path {
  font-size: 1rem;
  font-weight: 600;
  color: #21313f;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.section-label {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 0.72rem;
  color: #8b98a5;
  font-weight: 700;
}

.entry-count {
  padding: 0.5rem 0.8rem;
  border-radius: 999px;
  background: #eef3f7;
  color: #506071;
  font-size: 0.85rem;
  font-weight: 700;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 65vh;
  overflow: auto;
  padding-right: 0.25rem;
  transition: opacity 0.15s ease;
}

.entry-list-loading {
  opacity: 0.4;
  pointer-events: none;
}

.entry-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  width: 100%;
  text-align: left;
  border: 1px solid rgba(113, 130, 149, 0.14);
  border-radius: 18px;
  background: #fff;
  padding: 0.95rem 1rem;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.entry-row:hover,
.entry-row.active {
  transform: translateY(-1px);
  border-color: rgba(0, 0, 0, 0.2);
  box-shadow: 0 10px 24px rgba(71, 85, 105, 0.08);
}

.entry-main,
.entry-side {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.entry-main {
  min-width: 0;
}

.entry-icon {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #f8fafc;
  color: #475569;
  font-size: 1.15rem;
  flex: 0 0 auto;
}

.entry-name {
  color: #21313f;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  color: #778697;
  font-size: 0.85rem;
}

.entry-size {
  color: #4a5c6d;
  font-size: 0.9rem;
  white-space: nowrap;
}

.open-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 0;
  background: #2c2e33;
  color: #fff;
}

.details-body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 0.95rem;
  border-radius: 16px;
  background: #f8fafc;
  min-width: 0;
}

.detail-row span {
  color: #708090;
  flex: 0 0 110px;
}

.detail-row strong {
  color: #1f2a37;
  text-align: right;
  min-width: 0;
  flex: 1 1 auto;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.path-detail {
  max-width: 100%;
  overflow-wrap: anywhere;
}

/* ── Tablet (≤ 991px) ── */
@media (max-width: 991px) {
  /* Stack browser + details vertically */
  .explorer-grid {
    grid-template-columns: 1fr;
  }

  .entry-list {
    max-height: none;
  }
}

/* ── Mobile (≤ 767px) ── */
@media (max-width: 767px) {
  /* Reduce card padding */
  .toolbar-card {
    padding: 0.75rem;
  }

  .browser-card,
  .details-card {
    padding: 1rem;
  }

  /* Stack path title above actions so long paths don't squeeze them sideways */
  .browser-card-header {
    flex-direction: column;
    gap: 0.6rem;
  }

  .browser-header-actions {
    justify-content: flex-start;
    width: 100%;
  }

  /* Path toolbar: up-btn + breadcrumb on row 1, path input full-width on row 2 */
  .path-toolbar {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
  }

  .path-input-wrap {
    grid-column: 1 / -1;
    min-height: 44px;
  }

  .tool-btn {
    width: 38px;
    height: 38px;
  }

  /* Compact detail rows — keep label + value side by side */
  .detail-row {
    padding: 0.5rem 0.65rem;
    gap: 0.5rem;
  }

  .detail-row span {
    flex: 0 0 75px;
    font-size: 0.78rem;
  }

  .details-body {
    gap: 0.35rem;
  }

  /* Reduce entry spacing */
  .entry-row {
    padding: 0.7rem 0.75rem;
    border-radius: 14px;
  }

  .entry-list {
    gap: 0.5rem;
  }

  .entry-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    font-size: 1rem;
  }

  /* State cards */
  .state-card,
  .browser-state,
  .details-empty {
    min-height: 200px;
    padding: 1.5rem;
  }
}

/* ── Small phones (≤ 480px) — icon-only header buttons ── */
@media (max-width: 480px) {
  .btn-text {
    display: none;
  }

  .header-actions .btn {
    padding-left: 0.65rem;
    padding-right: 0.65rem;
  }

}
</style>
