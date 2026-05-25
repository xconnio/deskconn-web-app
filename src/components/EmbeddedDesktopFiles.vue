<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ApplicationError, type Session } from 'xconn'

import { useSessionCacheStore } from '@/stores/sessionCache'
import { useSettingsStore } from '@/stores/settings'
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
const procedureFileRename = 'io.xconn.deskconn.deskconnd.file.rename'
const procedureFileDelete = 'io.xconn.deskconn.deskconnd.file.delete'
const procedureFileCopy = 'io.xconn.deskconn.deskconnd.file.copy'
const procedureFileDownload = 'io.xconn.deskconn.deskconnd.file.download'
const procedureFileSearch = 'io.xconn.deskconn.deskconnd.file.search'
const outsideHomeMessage = 'Access denied. You can only browse files inside the home directory.'

const props = defineProps<{
  realm: string
  desktopName?: string
}>()

const sessionCacheStore = useSessionCacheStore()
const settingsStore = useSettingsStore()

const session = ref<Session | null>(null)
const encryptionKeys = ref<EncryptionKeys | null>(null)
const isConnecting = ref(true)
const isLoading = ref(false)
const errorMessage = ref('')
const currentBrowse = ref<FileBrowseResult | null>(null)
const selectedEntry = ref<FileEntry | null>(null)
const pathInput = ref('')
const showHiddenFiles = ref(false)
const searchMode = ref(false)
const entryListRef = ref<HTMLElement | null>(null)

const actionSheetEntry = ref<FileEntry | null>(null)
const actionSheetVisible = ref(false)
const dropdownPos = ref<{ top: number; right: number } | null>(null)
const showRenameDialog = ref(false)
const showDeleteDialog = ref(false)
const renameInput = ref('')
const clipboard = ref<FileEntry | null>(null)
const isOperating = ref(false)
const operationError = ref('')
const supportedFileProcedures = ref({
  rename: false,
  delete: false,
  copy: false,
})

type FilePreviewType = 'image' | 'audio' | 'video' | 'text' | 'pdf' | 'none'

const previewVisible = ref(false)
const previewFullscreen = ref(false)
const previewFileEntry = ref<FileEntry | null>(null)
const previewType = ref<FilePreviewType>('none')
const previewBlobUrl = ref('')
const previewTextContent = ref('')
const previewError = ref('')
const previewLoading = ref(false)
const mediaRetryUsed = ref(false)
const previewExpectedBytes = ref(0)
const previewReceivedBytes = ref(0)
const previewBodyEl = ref<HTMLElement | null>(null)
const navHistory = ref<string[]>([])
const navHistoryIndex = ref(-1)

const fileSearchActive = ref(false)
const fileSearchQuery = ref('')
const fileSearchResults = ref<FileEntry[]>([])
const fileSearching = ref(false)
const fileSearchError = ref('')
let searchGeneration = 0

const canGoBack = computed(() => navHistoryIndex.value > 0)
const canGoForward = computed(() => navHistoryIndex.value < navHistory.value.length - 1)

const visibleSearchResults = computed(() => {
  if (!showHiddenFiles.value) {
    return fileSearchResults.value.filter(e => !e.hidden && !e.name.startsWith('.'))
  }
  return fileSearchResults.value
})

const hoveredEntry = ref<FileEntry | null>(null)

const thumbnailUrls = reactive<Record<string, string>>({})

const selectionStatus = computed(() => {
  const entry = hoveredEntry.value ?? selectedEntry.value
  if (!entry) return ''
  if (entry.is_dir) {
    const count = entry.item_count ?? 0
    return `"${entry.name}" selected (containing ${count} ${count === 1 ? 'item' : 'items'})`
  }
  return `"${entry.name}" selected (${formatSize(entry.size)})`
})

function scrollPreviewBody(e: WheelEvent) {
  const body = previewBodyEl.value
  if (!body) return
  const child = Array.from(body.children).find(
    (el) => (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight
  ) as HTMLElement | undefined
  ;(child ?? body).scrollTop += e.deltaY
}

const isGridView = ref(false)
const backgroundMenuVisible = ref(false)
const backgroundMenuPos = ref<{ x: number; y: number } | null>(null)
const propertiesModalVisible = ref(false)
const propertiesModalEntry = ref<FileEntry | null>(null)

type DownloadProgressState = {
  name: string
  received: number
  total: number
  speed: number
  cancel: () => void
}
const downloadProgress = ref<DownloadProgressState | null>(null)
let downloadServiceWorker: ServiceWorker | null = null
let downloadServiceWorkerReadyPromise: Promise<ServiceWorker | null> | null = null

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

const hasEntryActions = computed(
  () =>
    supportedFileProcedures.value.rename ||
    supportedFileProcedures.value.delete ||
    supportedFileProcedures.value.copy,
)

const canDownload = computed(() => !!session.value)

function entryHasMenu(entry: FileEntry) {
  if (entry.is_symlink) return true
  if (!entry.is_dir) return canDownload.value
  return hasEntryActions.value
}

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
    item_count: getValue(source, 'item_count', 'ItemCount') as number | undefined,
    thumbnail: getStringValue(source, 'thumbnail', 'Thumbnail') || undefined,
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

function isNoSuchProcedureException(error: unknown) {
  if (error instanceof ApplicationError) {
    return (error.message || '').toLowerCase() === 'wamp.error.no_such_procedure'
  }

  if (error instanceof Error) {
    return (error.message || '').toLowerCase().includes('wamp.error.no_such_procedure')
  }

  return false
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
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/.test(lowered)) return 'bi-image-fill'
  if (/\.(zip|tar|gz|xz|7z|rar|bz2)$/.test(lowered)) return 'bi-file-earmark-zip-fill'
  if (/\.(mp3|ogg|wav|flac|aac|m4a|opus)$/.test(lowered)) return 'bi-file-earmark-music-fill'
  if (/\.(mp4|webm|mov|ogv|avi|mkv)$/.test(lowered)) return 'bi-file-earmark-play-fill'
  if (/\.(pdf)$/.test(lowered)) return 'bi-file-earmark-pdf-fill'
  if (/\.(json|yaml|yml|toml|xml|ini|conf|env)$/.test(lowered)) return 'bi-filetype-yml'
  if (/\.(md|txt|log)$/.test(lowered)) return 'bi-file-earmark-text-fill'
  if (/\.(sh|bash|zsh|py|js|ts|jsx|tsx|go|rs|c|cpp|h|hpp|java|rb|php|vue|svelte|sql|css|html|htm)$/.test(lowered)) return 'bi-file-earmark-code-fill'

  return 'bi-file-earmark-fill'
}

function iconStyleForEntry(entry: FileEntry): { color: string; background: string } {
  if (entry.is_dir) return { color: '#334155', background: '#e2e8f0' }
  if (entry.is_symlink) return { color: '#a78bfa', background: '#ede9fe' }

  const lowered = entry.name.toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/.test(lowered)) return { color: '#f472b6', background: '#fce7f3' }
  if (/\.(zip|tar|gz|xz|7z|rar|bz2)$/.test(lowered)) return { color: '#fb923c', background: '#ffedd5' }
  if (/\.(mp3|ogg|wav|flac|aac|m4a|opus)$/.test(lowered)) return { color: '#60a5fa', background: '#dbeafe' }
  if (/\.(mp4|webm|mov|ogv|avi|mkv)$/.test(lowered)) return { color: '#818cf8', background: '#e0e7ff' }
  if (/\.(pdf)$/.test(lowered)) return { color: '#f87171', background: '#fee2e2' }
  if (/\.(json|yaml|yml|toml|xml|ini|conf|env)$/.test(lowered)) return { color: '#34d399', background: '#d1fae5' }
  if (/\.(md|txt|log)$/.test(lowered)) return { color: '#94a3b8', background: '#f1f5f9' }
  if (/\.(sh|bash|zsh|py|js|ts|jsx|tsx|go|rs|c|cpp|h|hpp|java|rb|php|vue|svelte|sql|css|html|htm)$/.test(lowered)) return { color: '#a855f7', background: '#f5f3ff' }

  return { color: '#94a3b8', background: '#f8fafc' }
}

function getFilePreviewType(name: string): FilePreviewType {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (/^(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(ext)) return 'image'
  if (/^(mp3|ogg|wav|flac|aac|m4a|opus)$/.test(ext)) return 'audio'
  if (/^(mp4|webm|mov|ogv)$/.test(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (/^(txt|md|log|json|yaml|yml|toml|xml|ini|conf|env|sh|bash|zsh|py|js|ts|jsx|tsx|css|html|htm|go|rs|c|cpp|h|hpp|java|rb|php|csv|vue|svelte|sql)$/.test(ext)) return 'text'
  return 'none'
}

function getMimeType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  const m: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogv: 'video/ogg',
    pdf: 'application/pdf',
  }
  return m[ext] || 'application/octet-stream'
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

function disconnectDesktopSession() {
  session.value = null
}

function resetExplorerState() {
  currentBrowse.value = null
  selectedEntry.value = null
  pathInput.value = ''
  errorMessage.value = ''
  isLoading.value = false
  encryptionKeys.value = null
  navHistory.value = []
  navHistoryIndex.value = -1
  supportedFileProcedures.value = {
    rename: false,
    delete: false,
    copy: false,
  }
  clipboard.value = null
  closeActionSheet()
  closePreview()
  searchGeneration++
  fileSearchActive.value = false
  fileSearchQuery.value = ''
  fileSearchResults.value = []
  fileSearchError.value = ''
  fileSearching.value = false
}

async function performKeyExchange(): Promise<boolean> {
  if (!session.value) return false

  const { publicKey, privateKey } = createX25519KeyPair()

  let result
  try {
    result = await session.value.call(procedureKeyExchange, [publicKey])
  } catch (error) {
    if (isNoSuchProcedureException(error)) {
      return false
    }
    throw error
  }

  const serverKeyBytes = result.args?.[0] as Uint8Array
  if (!serverKeyBytes?.length) {
    throw new Error('Invalid server public key received during key exchange')
  }

  encryptionKeys.value = await deriveSessionKeys(privateKey, serverKeyBytes)
  return true
}

async function probeFileOperation(procedure: string): Promise<boolean> {
  if (!session.value || !encryptionKeys.value) return false

  try {
    await callFileOperation(procedure, {})
    return true
  } catch (error) {
    if (isNoSuchProcedureException(error)) {
      return false
    }

    return true
  }
}

async function detectFileOperationSupport() {
  if (!session.value || !encryptionKeys.value) {
    supportedFileProcedures.value = {
      rename: false,
      delete: false,
      copy: false,
    }
    clipboard.value = null
    closeActionSheet()
    return
  }

  const [rename, deleteItem, copy] = await Promise.all([
    probeFileOperation(procedureFileRename),
    probeFileOperation(procedureFileDelete),
    probeFileOperation(procedureFileCopy),
  ])

  supportedFileProcedures.value = {
    rename,
    delete: deleteItem,
    copy,
  }

  if (!copy) {
    clipboard.value = null
  }

  if (!hasEntryActions.value) {
    closeActionSheet()
  }
}

async function loadPath(path = '', skipHistory = false) {
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
    let browse: FileBrowseResult | undefined

    if (keys) {
      const pathBytes = new TextEncoder().encode(requestedPath)
      const encryptedPath = encryptPayload(pathBytes, keys.encryptKey)
      const result = await session.value.call(procedureFileBrowse, [encryptedPath])

      const encryptedBytes = result.args?.[0] as Uint8Array
      if (!encryptedBytes?.length) throw new Error('Empty response from remote file browser')

      const decrypted = decryptPayload(encryptedBytes, keys.decryptKey)
      browse = parseBrowseResult(JSON.parse(new TextDecoder().decode(decrypted)))
    } else {
      const result = await session.value.call(
        procedureFileBrowse,
        requestedPath ? [requestedPath] : [''],
      )
      browse = result.args?.[0] ? parseBrowseResult(result.args[0]) : undefined
    }

    if (!browse || !browse.path) {
      throw new Error('Empty response from remote file browser')
    }

    if (!isPathWithinHome(browse.path, browse.home_path)) {
      throw new Error('Outside the home directory')
    }

    currentBrowse.value = browse
    pathInput.value = browse.path
    selectedEntry.value = null

    if (!skipHistory) {
      navHistory.value = navHistory.value.slice(0, navHistoryIndex.value + 1)
      navHistory.value.push(browse.path)
      navHistoryIndex.value = navHistory.value.length - 1
    }
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
    session.value = await sessionCacheStore.acquire(props.realm)
  } catch (error) {
    errorMessage.value = formatError(error)
    session.value = null
  } finally {
    isConnecting.value = false
  }
}

async function initializeExplorer() {
  resetExplorerState()
  disconnectDesktopSession()
  await connectDesktopSession()

  if (!session.value) return

  try {
    await performKeyExchange()
  } catch (error) {
    errorMessage.value = formatError(error)
    return
  }

  await detectFileOperationSupport()

  await loadPath('')
}

async function goUp() {
  if (!currentBrowse.value?.parent_path || !canGoUp.value) return
  await loadPath(currentBrowse.value.parent_path)
}

async function goBack() {
  if (!canGoBack.value) return
  navHistoryIndex.value--
  await loadPath(navHistory.value[navHistoryIndex.value], true)
}

async function goForward() {
  if (!canGoForward.value) return
  navHistoryIndex.value++
  await loadPath(navHistory.value[navHistoryIndex.value], true)
}

async function refreshCurrentPath() {
  await loadPath(currentBrowse.value?.path || '', true)
}

function selectEntry(entry: FileEntry) {
  selectedEntry.value = entry
}

// Resolves a symlink's link_target to an absolute path so the backend receives
// a plain file path. The backend uses Lstat for the download-header size; on a
// symlink Lstat returns the target-path length, not the file size, causing a
// stream-length mismatch. A resolved path avoids that entirely.
function resolveSymlinkTarget(entry: FileEntry): string | null {
  const target = entry.link_target
  if (!target) return null
  if (target.startsWith('/')) return target
  const lastSlash = entry.path.lastIndexOf('/')
  const parentDir = lastSlash > 0 ? entry.path.slice(0, lastSlash) : '/'
  const parts = `${parentDir}/${target}`.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..' && resolved.length > 0) resolved.pop()
    else if (part !== '.' && part !== '') resolved.push(part)
  }
  return '/' + resolved.join('/')
}

async function openEntry(entry: FileEntry) {
  if (entry.is_dir) {
    await loadPath(entry.path)
    return
  }

  if (entry.is_symlink) {
    // The backend uses Lstat, so the symlink path itself shows is_dir = false even
    // for directory symlinks, and gives the wrong size for files. Browse and download
    // the resolved target path directly so Lstat operates on the actual target.
    const resolvedPath = resolveSymlinkTarget(entry)
    const browsePath = resolvedPath ?? entry.path

    const prevBrowse = currentBrowse.value
    const prevHistory = navHistory.value.slice()
    const prevIndex = navHistoryIndex.value

    await loadPath(browsePath)

    if (currentBrowse.value?.is_dir) return  // directory symlink: navigation succeeded

    // File symlink: revert state and open the file.
    currentBrowse.value = prevBrowse
    navHistory.value = prevHistory
    navHistoryIndex.value = prevIndex
    if (prevBrowse) pathInput.value = prevBrowse.path

    await openFile(resolvedPath ? { ...entry, path: resolvedPath } : entry)
    return
  }

  selectEntry(entry)
}

async function submitPath() {
  await loadPath(pathInput.value.trim())
  searchMode.value = false
}

function enterSearchMode() {
  searchMode.value = true
  pathInput.value = currentBrowse.value?.path || ''
  nextTick(() => {
    const input = document.querySelector('.path-input') as HTMLInputElement | null
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function exitSearchMode() {
  searchMode.value = false
}

function openActionSheet(entry: FileEntry, event: MouseEvent) {
  const btn = event.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  const dropdownHeight = 132 // approx height of 3 items
  const fitsBelow = rect.bottom + dropdownHeight + 8 < window.innerHeight
  dropdownPos.value = {
    top: fitsBelow ? rect.bottom + 6 : rect.top - dropdownHeight - 6,
    right: Math.max(4, window.innerWidth - rect.right),
  }
  actionSheetEntry.value = entry
  actionSheetVisible.value = true
  operationError.value = ''
}

function closeActionSheet() {
  actionSheetVisible.value = false
  actionSheetEntry.value = null
  showRenameDialog.value = false
  showDeleteDialog.value = false
  operationError.value = ''
}

function closePreview() {
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value)
    previewBlobUrl.value = ''
  }
  previewVisible.value = false
  previewFullscreen.value = false
  previewTextContent.value = ''
  previewError.value = ''
  previewLoading.value = false
  previewFileEntry.value = null
}

// Size limits for formats that must be fully buffered before display
const MAX_SIZE_IMAGE_PDF = 100 * 1024 * 1024  // 100 MB
const MAX_SIZE_AUDIO_FALLBACK = 50 * 1024 * 1024 // 50 MB (WAV/FLAC without MSE)
const MAX_SIZE_VIDEO_FALLBACK = 200 * 1024 * 1024 // 200 MB (formats without MSE)

// Returns the first supported MSE MIME+codec string for the file, used for both
// MediaSource.isTypeSupported and addSourceBuffer. High-profile variants are tried
// first so the declared codec matches what real-world videos actually contain —
function getMSEMimeType(name: string): string | null {
  if (!('MediaSource' in window)) return null
  const ext = name.toLowerCase().split('.').pop() || ''

  const candidates: Record<string, string[]> = {
    // MP4/MOV are intentionally excluded from MSE: browsers vary in how strictly they
    // validate the declared audio codec against the actual stream, and we can't know
    // the audio codec before reading the file. All browsers play MP4/MOV reliably via
    // the full-buffer blob URL path using their native decoder.
    webm: [
      'video/webm; codecs="vp9,opus"',
      'video/webm; codecs="vp8,vorbis"',
      'video/webm; codecs="vp9"',
    ],
    ogv: [
      'video/ogg; codecs="theora,vorbis"',
      'video/ogg; codecs="theora"',
      'video/ogg',
    ],
    mp3:  ['audio/mpeg'],
    ogg:  ['audio/ogg; codecs=vorbis', 'audio/ogg; codecs=opus', 'audio/ogg'],
    opus: ['audio/ogg; codecs=opus'],
    aac:  ['audio/mp4; codecs="mp4a.40.2"'],
    m4a:  ['audio/mp4; codecs="mp4a.40.2"'],
  }

  for (const mime of candidates[ext] ?? []) {
    if (MediaSource.isTypeSupported(mime)) return mime
  }
  return null
}

// Low-level stream: calls onChunk for each decrypted data chunk as it arrives.
async function streamFileData(
  remotePath: string,
  onChunk: (chunk: Uint8Array, expectedTotal: number) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const LATE_PROGRESS_WAIT_MS = 250
  const MAX_LATE_PROGRESS_WAIT_MS = 5_000

  if (!session.value) throw new Error('No active session')

  const { publicKey, privateKey } = createX25519KeyPair()

  type CallResult = Awaited<ReturnType<Session['call']>>

  const progressResult: any = await session.value.callProgress(procedureFileDownload, [ // eslint-disable-line @typescript-eslint/no-explicit-any
    remotePath, false, publicKey,
  ])

  // for-await over progressResult.receive() exits after the first message in Firefox.
  // The library's async iterator closes prematurely when the final WAMP RESULT arrives
  // before the iterator sets up its next waiter — a race that Chrome's event loop never
  // triggers but Firefox's does. Using the callback-based registerProgress API instead
  // routes all messages through a stable queue that is not affected by this race.
  const queue: CallResult[] = []
  let wakeUp: (() => void) | null = null
  let streamDone = false
  let streamError: unknown = null

  const notify = () => { const fn = wakeUp; wakeUp = null; fn?.() }

  progressResult.registerProgress((result: CallResult) => { queue.push(result); notify() })
  progressResult.finalResultPromise
    .then(() => { streamDone = true; notify() })
    .catch((err: unknown) => { streamError = err; streamDone = true; notify() })

  let receiveKey: Uint8Array | null = null
  let firstMessage = true
  let expectedTotal = 0
  let receivedTotal = 0
  let lateProgressWaitedMs = 0

  // Wake any suspended promise immediately so the abort check at the loop top fires.
  const onAbort = () => notify()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
  while (true) {
    if (signal?.aborted) throw new Error('cancelled')
    if (queue.length === 0) {
      if (streamDone) {
        if (expectedTotal > 0 && receivedTotal < expectedTotal) {
          await new Promise<void>((resolve) => {
            let settled = false
            const timer = window.setTimeout(() => {
              if (settled) return
              settled = true
              wakeUp = null
              resolve()
            }, LATE_PROGRESS_WAIT_MS)

            wakeUp = () => {
              if (settled) return
              settled = true
              window.clearTimeout(timer)
              wakeUp = null
              resolve()
            }
          })

          if (queue.length > 0) {
            lateProgressWaitedMs = 0
            continue
          }

          lateProgressWaitedMs += LATE_PROGRESS_WAIT_MS
          if (lateProgressWaitedMs < MAX_LATE_PROGRESS_WAIT_MS) continue
          throw new Error(
            `Download stream ended early (${receivedTotal} of ${expectedTotal} bytes received)`,
          )
        }
        break
      }
      await new Promise<void>(resolve => { wakeUp = resolve })
      continue
    }

    const result = queue.shift()!
    const args = (result.args ?? []) as unknown[]

    if (firstMessage) {
      firstMessage = false
      const raw = args[0] as Uint8Array
      if (raw.length < 36) throw new Error('Invalid key exchange message from server')
      const keys = await deriveSessionKeys(privateKey, raw.slice(4))
      receiveKey = keys.decryptKey
      continue
    }

    if (!receiveKey || args.length < 2) continue
    const msgType = args[0]
    if (typeof msgType !== 'string') continue

    if (msgType === 'H') {
      const plaintext = decryptPayload(args[1] as Uint8Array, receiveKey)
      const header = JSON.parse(new TextDecoder().decode(plaintext)) as { size?: number }
      expectedTotal = header.size ?? 0
    } else if (msgType === 'D') {
      const chunk = decryptPayload(args[1] as Uint8Array, receiveKey)
      receivedTotal += chunk.length
      await onChunk(chunk, expectedTotal)
    }
  }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }

  if (streamError) throw streamError instanceof Error ? streamError : new Error('Stream failed')
}

// Collects all chunks into a single Uint8Array (for images, PDF, text).
async function fetchFileData(remotePath: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  await streamFileData(remotePath, (chunk, expectedTotal) => {
    chunks.push(chunk)
    total += chunk.length
    previewExpectedBytes.value = expectedTotal
    previewReceivedBytes.value = total
  })

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  return combined
}

// Streams audio/video directly into a MediaSource so playback starts immediately.
// Returns false if MSE setup failed (caller should fall back to full-buffer).
async function openWithMediaSource(entry: FileEntry, mseMime: string): Promise<boolean> {
  const mediaSource = new MediaSource()
  const blobUrl = URL.createObjectURL(mediaSource)

  previewFileEntry.value = entry
  previewType.value = getFilePreviewType(entry.name) as FilePreviewType
  previewBlobUrl.value = blobUrl
  previewVisible.value = true
  previewLoading.value = false  // player is shown immediately; browser shows buffering state
  previewExpectedBytes.value = entry.size
  previewReceivedBytes.value = 0
  previewError.value = ''

  const queue: Uint8Array[] = []
  let isAppending = false
  let streamDone = false
  let sourceBuffer: SourceBuffer | null = null
  // Aborted when the SourceBuffer fires an error (e.g. audio codec mismatch, non-fragmented
  // MP4 in Firefox). Aborting cancels streamFileData so openWithMediaSource returns false
  // and the caller falls back to full-buffer.
  const sourceAbort = new AbortController()

  function drainQueue() {
    if (!sourceBuffer || isAppending || mediaSource.readyState !== 'open') return
    if (queue.length === 0) {
      if (streamDone) {
        try { mediaSource.endOfStream() } catch { /* already ended */ }
      }
      return
    }
    isAppending = true
    try {
      sourceBuffer.appendBuffer(queue.shift()!.slice())
    } catch {
      isAppending = false
    }
  }

  await new Promise<void>(resolve => {
    mediaSource.addEventListener('sourceopen', () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mseMime)
        sourceBuffer.addEventListener('updateend', () => { isAppending = false; drainQueue() })
        sourceBuffer.addEventListener('error', () => {
          isAppending = false
          previewFileEntry.value = null
          sourceAbort.abort()
        })
      } catch { /* unsupported codec at runtime — sourceBuffer stays null */ }
      resolve()
    }, { once: true })
  })

  if (!sourceBuffer) {
    URL.revokeObjectURL(blobUrl)
    try { mediaSource.endOfStream() } catch { /* ignore */ }
    previewBlobUrl.value = ''
    previewVisible.value = false
    previewFileEntry.value = null
    return false
  }

  try {
    await streamFileData(entry.path, (chunk, expectedTotal) => {
      if (previewFileEntry.value?.path !== entry.path) return
      if (expectedTotal > 0) previewExpectedBytes.value = expectedTotal
      previewReceivedBytes.value += chunk.length
      queue.push(chunk)
      drainQueue()
    }, sourceAbort.signal)
    streamDone = true
    drainQueue()
  } catch (err) {
    if (sourceAbort.signal.aborted) {
      // SourceBuffer error aborted the stream — signal failure so caller uses full-buffer.
      return false
    }
    if (previewFileEntry.value?.path === entry.path) {
      previewError.value = err instanceof Error ? err.message : 'Failed to stream file'
    }
  }
  return true
}

async function openFile(entry: FileEntry, isRetry = false) {
  if (entry.is_dir) return
  selectEntry(entry)
  if (!isRetry) mediaRetryUsed.value = false

  // For symlinks use the target filename for extension-based type detection,
  // since the symlink name itself may have no extension.
  const effectiveName = entry.is_symlink && entry.link_target
    ? (entry.link_target.replace(/\/$/, '').split('/').pop() || entry.name)
    : entry.name

  const pt = getFilePreviewType(effectiveName)

  // Unrecognised or oversized text → download directly
  if (pt === 'none' || (pt === 'text' && entry.size > 5 * 1024 * 1024)) {
    await downloadFileToClient(entry)
    return
  }

  // Image / PDF: enforce memory limit
  if ((pt === 'image' || pt === 'pdf') && entry.size > MAX_SIZE_IMAGE_PDF) {
    await downloadFileToClient(entry)
    return
  }

  // Audio / video: prefer MediaSource streaming (no memory limit needed)
  if (pt === 'audio' || pt === 'video') {
    const mseMime = !isRetry ? getMSEMimeType(effectiveName) : null
    if (mseMime) {
      closePreview()
      const mseStarted = await openWithMediaSource(entry, mseMime)
      if (mseStarted) return
      // addSourceBuffer failed (codec unsupported at runtime) — fall through to full-buffer
    }
    // Fallback for formats MSE can't handle: full-buffer with size guard
    const limit = pt === 'audio' ? MAX_SIZE_AUDIO_FALLBACK : MAX_SIZE_VIDEO_FALLBACK
    if (entry.size > limit) {
      await downloadFileToClient(entry)
      return
    }
  }

  // Full-buffer path for images, PDF, text, and MSE-unsupported audio/video
  closePreview()
  previewFileEntry.value = entry
  previewType.value = pt
  previewVisible.value = true
  previewLoading.value = true
  previewExpectedBytes.value = entry.size
  previewReceivedBytes.value = 0
  previewError.value = ''

  try {
    const data = await fetchFileData(entry.path)
    if (previewFileEntry.value?.path !== entry.path) return

    if (pt === 'text') {
      previewTextContent.value = new TextDecoder('utf-8', { fatal: false }).decode(data)
    } else {
      const mime = getMimeType(effectiveName)
      const blob = new Blob([data.slice()], { type: mime })
      previewBlobUrl.value = URL.createObjectURL(blob)
    }
  } catch (err) {
    if (previewFileEntry.value?.path === entry.path) {
      previewError.value = err instanceof Error ? err.message : 'Failed to load file'
    }
  } finally {
    if (previewFileEntry.value?.path === entry.path) {
      previewLoading.value = false
    }
  }
}

async function downloadFileToClient(entry: FileEntry) {
  if (entry.is_dir) return

  const STALL_MS = 20_000
  const controller = new AbortController()
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stalledOut = false

  function armStall() {
    if (stallTimer !== null) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => { stalledOut = true; controller.abort() }, STALL_MS)
  }
  function clearStall() {
    if (stallTimer !== null) { clearTimeout(stallTimer); stallTimer = null }
  }
  function onError(err: unknown) {
    if (stalledOut) {
      operationError.value = 'Download stalled — machine may have disconnected.'
    } else if (!controller.signal.aborted) {
      operationError.value = err instanceof Error ? err.message : 'Download failed'
    }
  }

  if (!isFirefoxBrowser() && 'showSaveFilePicker' in window) {
    await downloadFileWithSavePicker(entry, controller, armStall, clearStall, onError)
    return
  }

  try {
    await downloadFileWithBrowserDownload(entry, controller.signal, armStall, clearStall)
  } catch (err) {
    clearStall()
    onError(err)
  }
}

function isFirefoxBrowser() {
  return /firefox/i.test(navigator.userAgent)
}

async function downloadFileWithSavePicker(
  entry: FileEntry,
  controller: AbortController,
  armStall: () => void,
  clearStall: () => void,
  onError: (err: unknown) => void,
) {
  let writable: FileSystemWritableFileStream | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (window as any).showSaveFilePicker({ suggestedName: entry.name })
    writable = await handle.createWritable()
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return
    operationError.value = err instanceof Error ? err.message : 'Could not open save dialog'
    return
  }

  const startTime = Date.now()
  let received = 0
  downloadProgress.value = {
    name: entry.name,
    received: 0,
    total: entry.size,
    speed: 0,
    cancel: () => controller.abort(),
  }
  armStall()

  try {
    await streamFileData(entry.path, async (chunk, expectedTotal) => {
      armStall()
      await writable!.write(chunk.slice())
      received += chunk.length
      if (!downloadProgress.value) return
      downloadProgress.value.received = received
      if (expectedTotal > 0) downloadProgress.value.total = expectedTotal
      const elapsed = (Date.now() - startTime) / 1000
      downloadProgress.value.speed = elapsed > 0 ? received / elapsed : 0
    }, controller.signal)
    await writable!.close()
  } catch (err) {
    try { await writable?.abort() } catch { /* ignore */ }
    onError(err)
  } finally {
    clearStall()
    downloadProgress.value = null
  }
}

async function downloadFileWithBrowserDownload(
  entry: FileEntry,
  signal: AbortSignal,
  armStall: () => void,
  clearStall: () => void,
) {
  armStall()
  const sw = downloadServiceWorker ?? await ensureDownloadServiceWorker()
  if (!sw) throw new Error('Browser downloads are not available in this browser')

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let sentDownloadMeta = false
  let pendingPulls = 0
  let bridgeError: Error | null = null
  let pullWaiter: (() => void) | null = null
  const mc = new MessageChannel()
  const keepAliveTimer = window.setInterval(() => {
    sw.postMessage({ type: 'ping', id })
  }, 10_000)

  function resolvePull() {
    if (pullWaiter) {
      const resolve = pullWaiter
      pullWaiter = null
      resolve()
      return
    }
    pendingPulls += 1
  }

  function waitForPullSignal() {
    if (bridgeError) return Promise.reject(bridgeError)
    if (pendingPulls > 0) {
      pendingPulls -= 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      pullWaiter = () => {
        if (bridgeError) {
          reject(bridgeError)
          return
        }
        resolve()
      }
    })
  }

  mc.port1.onmessage = (event) => {
    const data = event.data ?? {}
    if (data.type === 'pull') {
      resolvePull()
      return
    }
    if (data.type === 'error') {
      bridgeError = new Error(data.message || 'Download bridge failed')
      if (pullWaiter) {
        const resolve = pullWaiter
        pullWaiter = null
        resolve()
      }
    }
  }

  sw.postMessage(
    { type: 'download', id, filename: entry.name },
    [mc.port2],
  )

  const a = document.createElement('a')
  a.href = `/_dl/${id}`
  a.download = entry.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  try {
    await streamFileData(entry.path, async (chunk, expectedTotal) => {
      armStall()
      if (!sentDownloadMeta) {
        mc.port1.postMessage({
          type: 'meta',
          filename: entry.name,
          size: expectedTotal > 0 ? expectedTotal : 0,
        })
        sentDownloadMeta = true
      }
      await waitForPullSignal()
      if (bridgeError) throw bridgeError
      const payload = chunk.slice().buffer
      mc.port1.postMessage({ type: 'chunk', chunk: payload }, [payload])
    }, signal)
    mc.port1.postMessage({ type: 'close' })
  } catch (err) {
    mc.port1.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Download failed',
    })
    throw err
  } finally {
    window.clearInterval(keepAliveTimer)
    clearStall()
  }
}

async function ensureDownloadServiceWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null
  if (downloadServiceWorker) return downloadServiceWorker
  if (!downloadServiceWorkerReadyPromise) {
    downloadServiceWorkerReadyPromise = (async () => {
      await navigator.serviceWorker.register('/sw-download.js', { scope: '/' })
      await navigator.serviceWorker.ready
      if (navigator.serviceWorker.controller) {
        downloadServiceWorker = navigator.serviceWorker.controller
        return downloadServiceWorker
      }

      downloadServiceWorker = await new Promise<ServiceWorker>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (navigator.serviceWorker.controller) resolve(navigator.serviceWorker.controller)
        }, { once: true })
      })
      return downloadServiceWorker
    })().catch((err) => {
      downloadServiceWorkerReadyPromise = null
      throw err
    })
  }

  return downloadServiceWorkerReadyPromise
}

function enterFileSearch() {
  fileSearchActive.value = true
  fileSearchQuery.value = ''
  fileSearchResults.value = []
  fileSearchError.value = ''
  fileSearching.value = false
  nextTick(() => {
    const input = document.querySelector('.file-search-input') as HTMLInputElement | null
    if (input) input.focus()
  })
}

function exitFileSearch() {
  searchGeneration++
  fileSearchActive.value = false
  fileSearchQuery.value = ''
  fileSearchResults.value = []
  fileSearchError.value = ''
  fileSearching.value = false
}

function onSearchQueryInput() {
  const q = fileSearchQuery.value.trim()
  if (!q) {
    fileSearchResults.value = []
    fileSearching.value = false
    return
  }
  void executeSearch(q)
}

async function executeSearch(query: string) {
  if (!session.value || !encryptionKeys.value) return
  const gen = ++searchGeneration
  const keys = encryptionKeys.value
  const searchPath = currentBrowse.value?.path || ''

  fileSearchResults.value = []
  fileSearchError.value = ''
  fileSearching.value = true

  try {
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({ path: searchPath, query, show_hidden: showHiddenFiles.value }),
    )
    const encrypted = encryptPayload(payloadBytes, keys.encryptKey)

    type CallResult = Awaited<ReturnType<Session['call']>>
    const progressResult: any = await session.value.callProgress(procedureFileSearch, [encrypted]) // eslint-disable-line @typescript-eslint/no-explicit-any

    progressResult.registerProgress((result: CallResult) => {
      if (gen !== searchGeneration) return
      try {
        const encryptedMsg = result.args?.[0] as Uint8Array
        if (!encryptedMsg?.length) return
        const decrypted = decryptPayload(encryptedMsg, keys.decryptKey)
        const parsed = JSON.parse(new TextDecoder().decode(decrypted))
        if (Array.isArray(parsed)) {
          fileSearchResults.value.push(...(parsed as unknown[]).map(parseFileEntry))
        } else if (parsed && typeof parsed === 'object' && 'path' in parsed && 'thumbnail' in parsed) {
          const { path, thumbnail } = parsed as { path: string; thumbnail: string }
          if (thumbnail) thumbnailUrls[path] = `data:image/jpeg;base64,${thumbnail}`
        }
      } catch { /* ignore malformed messages */ }
    })

    await progressResult.finalResultPromise
  } catch (err) {
    if (gen === searchGeneration) {
      fileSearchError.value = err instanceof Error ? err.message : 'Search failed'
    }
  } finally {
    if (gen === searchGeneration) fileSearching.value = false
  }
}

function searchResultParent(entry: FileEntry): string {
  const root = currentBrowse.value?.path || ''
  const parent = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  if (parent === root) return '.'
  if (parent.startsWith(root + '/')) return parent.slice(root.length + 1)
  return parent
}

async function openSearchResult(entry: FileEntry) {
  exitFileSearch()
  if (entry.is_dir) {
    await loadPath(entry.path)
    return
  }
  const parentDir = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  await loadPath(parentDir)
  await openFile(entry)
}

function handleMediaError(event: Event) {
  const media = event.target as HTMLMediaElement
  if (!media.error) return
  const entry = previewFileEntry.value
  if (!entry) return
  if (!mediaRetryUsed.value) {
    mediaRetryUsed.value = true
    openFile(entry, true)
  } else {
    previewError.value = 'This file could not be played. Use the Download button above.'
  }
}

function downloadFromPreview() {
  if (!previewFileEntry.value) return
  const entry = previewFileEntry.value
  // For audio/video, previewBlobUrl may be a MediaSource URL (not a real blob),
  // so always trigger a proper download for these types.
  if (previewType.value === 'audio' || previewType.value === 'video') {
    downloadFileToClient(entry)
    return
  }
  if (previewBlobUrl.value) {
    const a = document.createElement('a')
    a.href = previewBlobUrl.value
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } else if (previewTextContent.value) {
    const blob = new Blob([previewTextContent.value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } else {
    downloadFileToClient(entry)
  }
}

async function openActionSheetEntry() {
  if (!actionSheetEntry.value || actionSheetEntry.value.is_dir) return
  const entry = actionSheetEntry.value
  closeActionSheet()
  await openFile(entry)
}

async function downloadActionSheetEntry() {
  if (!actionSheetEntry.value || actionSheetEntry.value.is_dir) return
  const entry = actionSheetEntry.value
  closeActionSheet()
  await downloadFileToClient(entry)
}

function startRename() {
  if (!actionSheetEntry.value || !supportedFileProcedures.value.rename) return
  renameInput.value = actionSheetEntry.value.name
  actionSheetVisible.value = false
  showRenameDialog.value = true
  operationError.value = ''
  nextTick(() => {
    const input = document.querySelector('.rename-input') as HTMLInputElement | null
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function startDelete() {
  if (!supportedFileProcedures.value.delete) return
  actionSheetVisible.value = false
  showDeleteDialog.value = true
  operationError.value = ''
}

function copyToClipboard() {
  if (!actionSheetEntry.value || !supportedFileProcedures.value.copy) return
  clipboard.value = actionSheetEntry.value
  closeActionSheet()
}

async function callFileOperation(procedure: string, payload: object): Promise<void> {
  if (!session.value || !encryptionKeys.value) {
    throw new Error('No active encrypted session. Please reconnect.')
  }

  const keys = encryptionKeys.value
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = encryptPayload(payloadBytes, keys.encryptKey)

  const result = await session.value.call(procedure, [encrypted])

  const encryptedResult = result.args?.[0]
  if (encryptedResult) {
    decryptPayload(encryptedResult as Uint8Array, keys.decryptKey)
  }
}

async function confirmRename() {
  if (!actionSheetEntry.value || !renameInput.value.trim() || !supportedFileProcedures.value.rename) {
    return
  }

  const newName = renameInput.value.trim()
  if (newName === actionSheetEntry.value.name) {
    showRenameDialog.value = false
    actionSheetEntry.value = null
    return
  }

  const parentDir = actionSheetEntry.value.path.slice(
    0,
    actionSheetEntry.value.path.lastIndexOf('/'),
  )
  const newPath = `${parentDir}/${newName}`

  isOperating.value = true
  operationError.value = ''

  try {
    await callFileOperation(procedureFileRename, {
      old_path: actionSheetEntry.value.path,
      new_path: newPath,
    })
    if (clipboard.value?.path === actionSheetEntry.value.path) {
      clipboard.value = null
    }
    if (selectedEntry.value?.path === actionSheetEntry.value.path) {
      selectedEntry.value = null
    }
    showRenameDialog.value = false
    actionSheetEntry.value = null
    await refreshCurrentPath()
  } catch (error) {
    operationError.value = formatError(error)
  } finally {
    isOperating.value = false
  }
}

async function confirmDelete() {
  if (!actionSheetEntry.value || !supportedFileProcedures.value.delete) return

  isOperating.value = true
  operationError.value = ''

  try {
    await callFileOperation(procedureFileDelete, { path: actionSheetEntry.value.path })
    if (clipboard.value?.path === actionSheetEntry.value.path) {
      clipboard.value = null
    }
    if (selectedEntry.value?.path === actionSheetEntry.value.path) {
      selectedEntry.value = null
    }
    showDeleteDialog.value = false
    actionSheetEntry.value = null
    await refreshCurrentPath()
  } catch (error) {
    operationError.value = formatError(error)
  } finally {
    isOperating.value = false
  }
}

async function pasteClipboard() {
  if (!clipboard.value || !currentBrowse.value || !supportedFileProcedures.value.copy) return

  const srcPath = clipboard.value.path
  const dstDir = currentBrowse.value.path
  let dstPath = `${dstDir}/${clipboard.value.name}`

  if (dstPath === srcPath) {
    const name = clipboard.value.name
    const dotIndex = clipboard.value.is_dir ? -1 : name.lastIndexOf('.')
    if (dotIndex > 0) {
      dstPath = `${dstDir}/${name.slice(0, dotIndex)}_copy${name.slice(dotIndex)}`
    } else {
      dstPath = `${dstDir}/${name}_copy`
    }
  }

  isOperating.value = true
  operationError.value = ''

  try {
    await callFileOperation(procedureFileCopy, { src: srcPath, dst: dstPath })
    clipboard.value = null
    await refreshCurrentPath()
  } catch (error) {
    operationError.value = formatError(error)
  } finally {
    isOperating.value = false
  }
}

function updateViewMode() {
  isGridView.value = window.innerWidth >= 768
}

function openContextMenuAtCursor(entry: FileEntry, event: MouseEvent) {
  selectedEntry.value = entry
  const menuWidth = 185
  const menuHeight = 280
  const right = Math.max(4, window.innerWidth - Math.min(event.clientX + menuWidth, window.innerWidth - 4))
  const top = Math.min(event.clientY, window.innerHeight - menuHeight - 8)
  dropdownPos.value = { top, right }
  actionSheetEntry.value = entry
  actionSheetVisible.value = true
  operationError.value = ''
}

function openBackgroundMenu(event: MouseEvent) {
  const menuWidth = 210
  const menuHeight = 150
  backgroundMenuPos.value = {
    x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
    y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
  }
  backgroundMenuVisible.value = true
}

function closeBackgroundMenu() {
  backgroundMenuVisible.value = false
  backgroundMenuPos.value = null
}

function showPropertiesFromMenu() {
  if (actionSheetEntry.value) {
    propertiesModalEntry.value = actionSheetEntry.value
    propertiesModalVisible.value = true
  }
  closeActionSheet()
}

function closePropertiesModal() {
  propertiesModalVisible.value = false
  propertiesModalEntry.value = null
}

function handleEntryPrimaryAction(entry: FileEntry) {
  if (entry.is_dir || entry.is_symlink) {
    openEntry(entry)
  } else {
    openFile(entry)
  }
}

function gridColumnCount(): number {
  if (!entryListRef.value) return 1
  return window.getComputedStyle(entryListRef.value).gridTemplateColumns.split(' ').length
}

function scrollSelectedIntoView() {
  nextTick(() => {
    entryListRef.value?.querySelector<HTMLElement>('.entry-row.active')?.scrollIntoView({ block: 'nearest' })
  })
}

function handleGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement

  if (e.key === 'Escape') {
    if (fileSearchActive.value) { exitFileSearch(); return }
    if (searchMode.value) { exitSearchMode(); return }
    if (propertiesModalVisible.value) { closePropertiesModal(); return }
    if (actionSheetVisible.value) { closeActionSheet(); return }
    if (backgroundMenuVisible.value) { closeBackgroundMenu(); return }
    return
  }

  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    if (!fileSearchActive.value && currentBrowse.value) enterFileSearch()
    return
  }

  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || searchMode.value || fileSearchActive.value) return

  if (e.ctrlKey) {
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); showHiddenFiles.value = !showHiddenFiles.value }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refreshCurrentPath() }
    return
  }

  if (propertiesModalVisible.value || actionSheetVisible.value || backgroundMenuVisible.value) return

  if (e.key === 'Backspace') {
    e.preventDefault()
    goUp()
    return
  }

  const entries = visibleEntries.value
  if (!entries.length) return

  const idx = selectedEntry.value ? entries.findIndex(e => e.path === selectedEntry.value!.path) : -1

  const moveTo = (i: number) => {
    selectedEntry.value = entries[Math.max(0, Math.min(i, entries.length - 1))] ?? null
    scrollSelectedIntoView()
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      moveTo(idx === -1 ? 0 : idx + (isGridView.value ? gridColumnCount() : 1))
      break
    case 'ArrowUp':
      e.preventDefault()
      moveTo(idx === -1 ? entries.length - 1 : idx - (isGridView.value ? gridColumnCount() : 1))
      break
    case 'ArrowRight':
      e.preventDefault()
      if (isGridView.value) moveTo(idx === -1 ? 0 : idx + 1)
      else if (selectedEntry.value) handleEntryPrimaryAction(selectedEntry.value)
      break
    case 'ArrowLeft':
      e.preventDefault()
      if (isGridView.value) moveTo(idx <= 0 ? 0 : idx - 1)
      break
    case 'Enter':
      if (selectedEntry.value) { e.preventDefault(); handleEntryPrimaryAction(selectedEntry.value) }
      break
  }
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

watch(previewVisible, (visible) => {
  document.body.style.overflow = visible ? 'hidden' : ''
})

function applyThumbnails(entries: FileEntry[]) {
  for (const entry of entries) {
    if (entry.thumbnail && !thumbnailUrls[entry.path]) {
      thumbnailUrls[entry.path] = `data:image/jpeg;base64,${entry.thumbnail}`
    }
  }
}


onMounted(async () => {
  updateViewMode()
  window.addEventListener('resize', updateViewMode)
  document.addEventListener('keydown', handleGlobalKeydown)
  if (isFirefoxBrowser()) {
    void ensureDownloadServiceWorker().catch(() => {})
  }
  await initializeExplorer()
})

watch(currentBrowse, (browse) => {
  if (browse?.is_dir && browse.entries?.length) {
    applyThumbnails(browse.entries)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateViewMode)
  document.removeEventListener('keydown', handleGlobalKeydown)
  disconnectDesktopSession()
  closePreview()
  for (const url of Object.values(thumbnailUrls)) URL.revokeObjectURL(url)
})

</script>

<template>
  <div class="embedded-explorer">
    <div class="explorer-shell">
      <section class="toolbar-card">
        <div class="path-toolbar">
          <button
            class="tool-btn"
            @click="goBack"
            :disabled="!canGoBack || isLoading || isConnecting"
            title="Go back"
          >
            <i class="bi bi-arrow-left"></i>
          </button>
          <button
            class="tool-btn"
            @click="goForward"
            :disabled="!canGoForward || isLoading || isConnecting"
            title="Go forward"
          >
            <i class="bi bi-arrow-right"></i>
          </button>
          <button
            class="tool-btn"
            @click="refreshCurrentPath"
            :disabled="isLoading || isConnecting"
            title="Refresh"
          >
            <i class="bi bi-arrow-clockwise"></i>
          </button>
          <button
            class="tool-btn"
            :class="{ 'tool-btn--active': fileSearchActive }"
            @click="fileSearchActive ? exitFileSearch() : enterFileSearch()"
            :disabled="isConnecting || !currentBrowse"
            title="Search (Ctrl+F)"
          >
            <i class="bi bi-search"></i>
          </button>

          <div
            class="breadcrumb-search-area"
            :class="{ 'breadcrumb-search-active': searchMode || fileSearchActive }"
            @click="!searchMode && !fileSearchActive && enterSearchMode()"
          >
            <template v-if="fileSearchActive">
              <i class="bi bi-search path-icon"></i>
              <input
                v-model="fileSearchQuery"
                type="text"
                class="path-input file-search-input"
                placeholder="Search in this folder…"
                @input="onSearchQueryInput"
                @keyup.escape="exitFileSearch"
              />
              <span v-if="fileSearching" class="search-spinner-wrap">
                <span class="spinner-border spinner-border-sm" role="status"></span>
              </span>
            </template>
            <template v-else-if="!searchMode">
              <div class="breadcrumb-strip" v-if="breadcrumbSegments.length > 0">
                <template v-for="(segment, index) in breadcrumbSegments" :key="segment.path">
                  <button
                    class="breadcrumb-chip"
                    :class="{ 'breadcrumb-chip-current': index === breadcrumbSegments.length - 1 }"
                    @click.stop="loadPath(segment.path)"
                  >
                    <i v-if="index === 0" class="bi bi-house me-1"></i>{{ segment.label }}
                  </button>
                  <span v-if="index < breadcrumbSegments.length - 1" class="breadcrumb-sep">/</span>
                </template>
              </div>
              <i class="bi bi-search breadcrumb-search-hint"></i>
            </template>

            <form v-else-if="searchMode" class="path-input-inner" @submit.prevent="submitPath">
              <i class="bi bi-folder2-open path-icon"></i>
              <input
                v-model="pathInput"
                type="text"
                class="path-input"
                placeholder="Enter a path"
                :disabled="isConnecting"
                @blur="exitSearchMode"
                @keyup.escape="exitSearchMode"
              />
            </form>
          </div>
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
        <section class="browser-card" @contextmenu.prevent="openBackgroundMenu($event)">
          <div v-if="currentBrowse" class="browser-card-header">
            <div class="browser-header-actions">
              <button
                v-if="clipboard && currentBrowse.is_dir && supportedFileProcedures.copy"
                class="paste-btn"
                :disabled="isOperating"
                @click="pasteClipboard"
                :title="`Paste &quot;${clipboard.name}&quot; here`"
              >
                <i class="bi bi-clipboard-check"></i>
                <span>Paste "{{ clipboard.name }}"</span>
              </button>
              <label v-if="currentBrowse.is_dir" class="hidden-toggle">
                <input v-model="showHiddenFiles" type="checkbox" />
                <span>Show hidden files</span>
              </label>
              <span class="entry-count">
                {{ currentBrowse.is_dir ? `${visibleEntries.length} entries` : currentBrowse.type }}
              </span>
            </div>
          </div>
          <div v-if="operationError && !actionSheetVisible && !showRenameDialog && !showDeleteDialog" class="alert alert-danger mb-0 mt-2 py-2 px-3">
            <i class="bi bi-exclamation-octagon me-2"></i>{{ operationError }}
            <button type="button" class="btn-close float-end" @click="operationError = ''"></button>
          </div>

          <!-- Search results -->
          <template v-if="fileSearchActive && fileSearchQuery.trim()">
            <div v-if="fileSearching && !visibleSearchResults.length" class="browser-state">
              <div class="spinner-border mb-3" role="status">
                <span class="visually-hidden">Searching…</span>
              </div>
              <p class="mb-0">Searching…</p>
            </div>
            <div
              v-else-if="visibleSearchResults.length > 0"
              ref="entryListRef"
              class="entry-list"
              :class="{ 'grid-view': isGridView }"
            >
              <button
                v-for="entry in visibleSearchResults"
                :key="entry.path"
                class="entry-row"
                :class="{ active: selectedEntry?.path === entry.path }"
                @click="openSearchResult(entry)"
                @mouseenter="hoveredEntry = entry"
                @mouseleave="hoveredEntry = null"
              >
                <div class="entry-main">
                  <span class="entry-icon" :class="{ 'entry-icon--thumb': thumbnailUrls[entry.path] }" :style="thumbnailUrls[entry.path] ? undefined : iconStyleForEntry(entry)">
                    <img v-if="thumbnailUrls[entry.path]" :src="thumbnailUrls[entry.path]" class="entry-thumb" :alt="entry.name" />
                    <i v-else class="bi" :class="iconClassForEntry(entry)"></i>
                  </span>
                  <div class="entry-text">
                    <div class="entry-name">{{ entry.name }}</div>
                    <div class="entry-meta entry-search-path">{{ searchResultParent(entry) }}</div>
                  </div>
                </div>
                <div class="entry-side">
                  <span class="entry-size">{{ entry.is_dir ? 'Folder' : formatSize(entry.size) }}</span>
                </div>
              </button>
            </div>
            <div v-else-if="fileSearchError" class="browser-state">
              <i class="bi bi-exclamation-octagon display-6 mb-3"></i>
              <p class="mb-0">{{ fileSearchError }}</p>
            </div>
            <div v-else-if="fileSearchQuery.trim()" class="browser-state">
              <i class="bi bi-search display-6 mb-3"></i>
              <p class="mb-0">No results for "{{ fileSearchQuery }}"</p>
            </div>
            <div v-else class="browser-state">
              <i class="bi bi-search display-6 mb-3"></i>
              <p class="mb-0 text-muted">Type to search files in this folder</p>
            </div>
          </template>

          <!-- Normal directory / file view -->
          <template v-else>

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
            ref="entryListRef"
            class="entry-list"
            :class="{ 'entry-list-loading': isLoading, 'grid-view': isGridView }"
            @contextmenu.self.prevent.stop="openBackgroundMenu($event)"
          >
            <button
              v-for="entry in visibleEntries"
              :key="entry.path"
              class="entry-row"
              :class="{ active: selectedEntry?.path === entry.path }"
              @click="settingsStore.singleClickOpen ? handleEntryPrimaryAction(entry) : (isGridView ? selectEntry(entry) : openEntry(entry))"
              @dblclick="handleEntryPrimaryAction(entry)"
              @contextmenu.prevent.stop="openContextMenuAtCursor(entry, $event)"
              @mouseenter="hoveredEntry = entry"
              @mouseleave="hoveredEntry = null"
            >
              <div class="entry-main">
                <span class="entry-icon" :class="{ 'entry-icon--thumb': thumbnailUrls[entry.path] }" :style="thumbnailUrls[entry.path] ? undefined : iconStyleForEntry(entry)">
                  <img v-if="thumbnailUrls[entry.path]" :src="thumbnailUrls[entry.path]" class="entry-thumb" :alt="entry.name" />
                  <i v-else class="bi" :class="iconClassForEntry(entry)"></i>
                </span>
                <div class="entry-text">
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
                <button
                  v-if="entryHasMenu(entry)"
                  class="menu-btn"
                  @click.stop="openActionSheet(entry, $event)"
                  title="More actions"
                >
                  <i class="bi bi-three-dots-vertical"></i>
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

          </template>

          <div v-if="selectionStatus" class="selection-status">
            {{ selectionStatus }}
          </div>
        </section>

      </div>
    </div>
  </div>

  <!-- Entry dropdown / right-click context menu -->
  <div v-if="actionSheetVisible && actionSheetEntry && dropdownPos" class="dropdown-backdrop" @click="closeActionSheet">
    <div
      class="entry-dropdown"
      :style="`top: ${dropdownPos.top}px; right: ${dropdownPos.right}px`"
      @click.stop
    >
      <button v-if="actionSheetEntry.is_dir || actionSheetEntry.is_symlink" class="dropdown-item" @click="openEntry(actionSheetEntry); closeActionSheet()">
        <i class="bi" :class="actionSheetEntry.is_dir ? 'bi-folder2-open' : 'bi-box-arrow-up-right'"></i>Open
      </button>
      <div v-if="(actionSheetEntry.is_dir || actionSheetEntry.is_symlink) && (supportedFileProcedures.rename || supportedFileProcedures.delete || supportedFileProcedures.copy)" class="dropdown-divider"></div>
      <template v-if="!actionSheetEntry.is_dir && !actionSheetEntry.is_symlink">
        <button class="dropdown-item" @click="openActionSheetEntry">
          <i class="bi" :class="getFilePreviewType(actionSheetEntry.name) !== 'none' ? 'bi-eye' : 'bi-download'"></i>
          {{ getFilePreviewType(actionSheetEntry.name) !== 'none' ? 'Open' : 'Download' }}
        </button>
        <button
          v-if="getFilePreviewType(actionSheetEntry.name) !== 'none'"
          class="dropdown-item"
          @click="downloadActionSheetEntry"
        >
          <i class="bi bi-download"></i>Download
        </button>
        <div
          v-if="supportedFileProcedures.rename || supportedFileProcedures.delete || supportedFileProcedures.copy"
          class="dropdown-divider"
        ></div>
      </template>
      <button v-if="supportedFileProcedures.rename" class="dropdown-item" @click="startRename">
        <i class="bi bi-pencil"></i>Rename
      </button>
      <button v-if="supportedFileProcedures.copy" class="dropdown-item" @click="copyToClipboard">
        <i class="bi bi-clipboard"></i>Copy
      </button>
      <div
        v-if="supportedFileProcedures.delete && (supportedFileProcedures.rename || supportedFileProcedures.copy)"
        class="dropdown-divider"
      ></div>
      <button
        v-if="supportedFileProcedures.delete"
        class="dropdown-item dropdown-item-danger"
        @click="startDelete"
      >
        <i class="bi bi-trash"></i>Delete
      </button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item" @click="showPropertiesFromMenu">
        <i class="bi bi-info-circle"></i>Properties
      </button>
    </div>
  </div>

  <!-- Background right-click context menu -->
  <div v-if="backgroundMenuVisible && backgroundMenuPos" class="dropdown-backdrop" @click="closeBackgroundMenu">
    <div
      class="entry-dropdown"
      :style="`top: ${backgroundMenuPos.y}px; left: ${backgroundMenuPos.x}px`"
      @click.stop
    >
      <button
        v-if="clipboard && currentBrowse?.is_dir && supportedFileProcedures.copy"
        class="dropdown-item"
        @click="closeBackgroundMenu(); pasteClipboard()"
      >
        <i class="bi bi-clipboard-check"></i>Paste "{{ clipboard?.name }}"
      </button>
      <div v-if="clipboard && currentBrowse?.is_dir && supportedFileProcedures.copy" class="dropdown-divider"></div>
      <button class="dropdown-item" @click="refreshCurrentPath(); closeBackgroundMenu()">
        <i class="bi bi-arrow-clockwise"></i>Refresh
      </button>
      <button class="dropdown-item" @click="showHiddenFiles = !showHiddenFiles; closeBackgroundMenu()">
        <i class="bi" :class="showHiddenFiles ? 'bi-eye-slash' : 'bi-eye'"></i>
        {{ showHiddenFiles ? 'Hide hidden files' : 'Show hidden files' }}
      </button>
    </div>
  </div>

  <!-- Properties popup -->
  <div v-if="propertiesModalVisible && propertiesModalEntry" class="fs-overlay dialog-overlay" @click.self="closePropertiesModal">
    <div class="properties-dialog">
      <div class="properties-header">
        <span class="properties-icon" :style="iconStyleForEntry(propertiesModalEntry)">
          <i class="bi" :class="iconClassForEntry(propertiesModalEntry)"></i>
        </span>
        <div class="properties-title-wrap">
          <h4 class="properties-name">{{ propertiesModalEntry.name }}</h4>
          <span class="properties-kind">{{ propertiesModalEntry.is_dir ? 'Folder' : propertiesModalEntry.type }}</span>
        </div>
        <button class="preview-close-btn" @click="closePropertiesModal">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="properties-body">
        <div class="prop-row">
          <span class="prop-label">Location</span>
          <span class="prop-value prop-mono">{{ propertiesModalEntry.path }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Size</span>
          <span class="prop-value">{{ formatSize(propertiesModalEntry.size) }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Modified</span>
          <span class="prop-value">{{ formatDate(propertiesModalEntry.mod_time) }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Permissions</span>
          <span class="prop-value prop-mono">{{ propertiesModalEntry.mode }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Type</span>
          <span class="prop-value">{{ propertiesModalEntry.type || (propertiesModalEntry.is_dir ? 'Directory' : 'File') }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Directory</span>
          <span class="prop-value">{{ propertiesModalEntry.is_dir ? 'Yes' : 'No' }}</span>
        </div>
        <div class="prop-row">
          <span class="prop-label">Symlink</span>
          <span class="prop-value">{{ propertiesModalEntry.is_symlink ? 'Yes' : 'No' }}</span>
        </div>
        <div v-if="propertiesModalEntry.link_target" class="prop-row">
          <span class="prop-label">Links to</span>
          <span class="prop-value prop-mono">{{ propertiesModalEntry.link_target }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Rename dialog -->
  <div v-if="showRenameDialog && actionSheetEntry" class="fs-overlay dialog-overlay" @click.self="showRenameDialog = false; operationError = ''">
    <div class="action-dialog">
      <h4 class="dialog-title">Rename</h4>
      <input
        v-model="renameInput"
        type="text"
        class="rename-input"
        placeholder="New name"
        :disabled="isOperating"
        @keyup.enter="confirmRename"
        @keyup.escape="showRenameDialog = false; operationError = ''"
      />
      <p v-if="operationError" class="op-error">{{ operationError }}</p>
      <div class="dialog-actions">
        <button class="dialog-btn" :disabled="isOperating" @click="showRenameDialog = false; operationError = ''">Cancel</button>
        <button class="dialog-btn dialog-btn-primary" :disabled="isOperating || !renameInput.trim()" @click="confirmRename">
          {{ isOperating ? 'Renaming…' : 'Rename' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Delete confirm dialog -->
  <div v-if="showDeleteDialog && actionSheetEntry" class="fs-overlay dialog-overlay" @click.self="showDeleteDialog = false; operationError = ''">
    <div class="action-dialog">
      <h4 class="dialog-title">Delete "{{ actionSheetEntry.name }}"?</h4>
      <p class="dialog-body">This action cannot be undone.</p>
      <p v-if="operationError" class="op-error">{{ operationError }}</p>
      <div class="dialog-actions">
        <button class="dialog-btn" :disabled="isOperating" @click="showDeleteDialog = false; operationError = ''">Cancel</button>
        <button class="dialog-btn dialog-btn-danger" :disabled="isOperating" @click="confirmDelete">
          {{ isOperating ? 'Deleting…' : 'Delete' }}
        </button>
      </div>
    </div>
  </div>

  <!-- File Preview Modal -->
  <div v-if="previewVisible" class="fs-overlay preview-overlay" @click.self="closePreview" @wheel.self.prevent="scrollPreviewBody">
    <div class="preview-dialog" :class="{ 'preview-dialog--fullscreen': previewFullscreen }">
      <div class="preview-header">
        <span class="preview-title">{{ previewFileEntry?.name }}</span>
        <div class="preview-header-actions">
          <button class="preview-close-btn" @click="downloadFromPreview" :disabled="previewLoading" title="Download">
            <i class="bi bi-download"></i>
          </button>
          <button class="preview-close-btn" @click="previewFullscreen = !previewFullscreen" :title="previewFullscreen ? 'Restore' : 'Maximize'">
            <i class="bi" :class="previewFullscreen ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'"></i>
          </button>
          <button class="preview-close-btn" @click="closePreview" title="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      <div class="preview-body" ref="previewBodyEl">
        <!-- Loading state -->
        <div v-if="previewLoading" class="preview-state">
          <div class="spinner-border mb-3" role="status">
            <span class="visually-hidden">Loading…</span>
          </div>
          <p v-if="previewExpectedBytes > 0" class="preview-progress-text">
            {{ formatSize(previewReceivedBytes) }} / {{ formatSize(previewExpectedBytes) }}
          </p>
          <p v-else class="preview-progress-text">Loading…</p>
        </div>

        <!-- Error state -->
        <div v-else-if="previewError" class="preview-state">
          <i class="bi bi-exclamation-octagon display-6 mb-3"></i>
          <p class="mb-0">{{ previewError }}</p>
        </div>

        <!-- Image -->
        <div v-else-if="previewType === 'image' && previewBlobUrl" class="preview-image-wrap">
          <img :src="previewBlobUrl" :alt="previewFileEntry?.name" class="preview-image" />
        </div>

        <!-- Audio -->
        <div v-else-if="previewType === 'audio' && previewBlobUrl" class="preview-audio-wrap">
          <div class="audio-icon"><i class="bi bi-music-note-beamed"></i></div>
          <p class="audio-name">{{ previewFileEntry?.name }}</p>
          <audio :src="previewBlobUrl" controls class="preview-audio" @error="handleMediaError" />
        </div>

        <!-- Video -->
        <div v-else-if="previewType === 'video' && previewBlobUrl" class="preview-video-wrap">
          <video :src="previewBlobUrl" controls class="preview-video" @error="handleMediaError" />
        </div>

        <!-- PDF -->
        <div v-else-if="previewType === 'pdf' && previewBlobUrl" class="preview-pdf-wrap">
          <iframe :src="previewBlobUrl" class="preview-pdf" />
        </div>

        <!-- Text -->
        <div v-else-if="previewType === 'text'" class="preview-text-wrap">
          <pre class="preview-text">{{ previewTextContent }}</pre>
        </div>
      </div>
    </div>
  </div>

  <Transition name="dl-toast">
    <div v-if="downloadProgress" class="dl-toast">
      <div class="dl-toast-header">
        <i class="bi bi-download dl-toast-icon"></i>
        <span class="dl-toast-title">Downloading</span>
        <button class="dl-toast-cancel" @click="downloadProgress.cancel()" title="Cancel">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="dl-toast-name">{{ downloadProgress.name }}</div>
      <div class="dl-progress-bar-wrap">
        <div
          class="dl-progress-bar"
          :style="{
            width: downloadProgress.total > 0
              ? `${Math.min(100, Math.round(downloadProgress.received / downloadProgress.total * 100))}%`
              : '0%'
          }"
        ></div>
      </div>
      <div class="dl-toast-meta">
        <span>{{ formatSize(downloadProgress.received) }} / {{ downloadProgress.total > 0 ? formatSize(downloadProgress.total) : '…' }}</span>
        <span>{{ downloadProgress.speed > 0 ? `${formatSize(Math.round(downloadProgress.speed))}/s` : '…' }}</span>
      </div>
    </div>
  </Transition>

</template>

<style scoped>
.embedded-explorer {
  background: transparent;
  padding: 0;
}

.explorer-shell {
  max-width: none;
}

.toolbar-card,
.browser-card,
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
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.75rem;
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
  grid-template-columns: auto auto auto auto 1fr;
  gap: 0.75rem;
  align-items: center;
}

.tool-btn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 7px;
  background: #2c2e33;
  color: #fff;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tool-btn:disabled {
  opacity: 0.5;
}

.tool-btn--active {
  background: var(--theme-primary, #3b82f6);
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
  padding: 0.25rem 0.35rem;
  background: transparent;
  color: #475569;
  font-weight: 600;
  font-size: 0.875rem;
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

.breadcrumb-search-area {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  min-height: 40px;
  cursor: pointer;
  overflow: hidden;
  min-width: 0;
}

.breadcrumb-search-area:hover {
  border-color: #cbd5e1;
}

.breadcrumb-search-active {
  cursor: default;
}

.breadcrumb-search-hint {
  margin-left: auto;
  color: #94a3b8;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.search-spinner-wrap {
  margin-left: auto;
  flex-shrink: 0;
  color: #94a3b8;
}

.entry-search-path {
  color: #94a3b8;
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.path-input-inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
}

.path-icon {
  color: #64748b;
  flex-shrink: 0;
}

.path-input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #21313f;
}

.state-card,
.browser-state {
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
  display: block;
}

.browser-card {
  padding: 1.25rem;
}

.browser-card-header {
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

.entry-count {
  padding: 0.5rem 0.8rem;
  border-radius: 999px;
  background: #eef3f7;
  color: #506071;
  font-size: 0.85rem;
  font-weight: 700;
}

.entry-icon--thumb {
  background: #111 !important;
  padding: 0;
  overflow: hidden;
}

.entry-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: inherit;
}

.selection-status {
  margin-top: 0.6rem;
  text-align: right;
  font-size: 0.78rem;
  color: #7a8fa3;
  padding: 0 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  flex: 1;
  min-width: 0;
}

.entry-side {
  flex-shrink: 0;
}

.entry-text {
  min-width: 0;
  overflow: hidden;
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


/* ── Mobile (≤ 767px) ── */
@media (max-width: 767px) {
  .toolbar-card {
    padding: 0.75rem;
  }

  .browser-card {
    padding: 1rem;
  }

  .browser-card-header {
    flex-direction: column;
    gap: 0.6rem;
  }

  .browser-header-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .entry-row {
    padding: 0.7rem 0.75rem;
    border-radius: 14px;
  }

  .entry-list {
    gap: 0.5rem;
    max-height: none;
  }

  .entry-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    font-size: 1rem;
  }

  .state-card,
  .browser-state {
    min-height: 200px;
    padding: 1.5rem;
  }
}

/* ── Menu button on entry rows ── */
.menu-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.menu-btn:hover {
  background: #f1f5f9;
  color: #0f172a;
}

/* ── Paste button ── */
.paste-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  border: 0;
  background: #2c2e33;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  max-width: 220px;
  transition: background 0.15s;
}

.paste-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paste-btn:hover:not(:disabled) {
  background: #1a1b1e;
}

.paste-btn:disabled {
  opacity: 0.5;
}

/* ── Full-screen overlay for dialogs ── */
.fs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  justify-content: center;
  backdrop-filter: blur(3px);
}

.dialog-overlay {
  align-items: center;
  padding: 1.25rem;
}

/* ── Entry dropdown ── */
.dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.entry-dropdown {
  position: fixed;
  z-index: 2001;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.07);
  border: 1px solid rgba(0, 0, 0, 0.08);
  min-width: 152px;
  padding: 0.3rem;
  animation: dropdown-pop 0.13s ease;
}

@keyframes dropdown-pop {
  from { transform: scale(0.88) translateY(-4px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}

.dropdown-item {
  width: 100%;
  text-align: left;
  padding: 0.6rem 0.75rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #21313f;
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  transition: background 0.12s;
  cursor: pointer;
}

.dropdown-item:hover {
  background: #f1f5f9;
}

.dropdown-item-danger {
  color: #dc2626;
}

.dropdown-item-danger:hover {
  background: #fef2f2;
}

.dropdown-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 0.2rem 0.5rem;
}

/* ── Dialog (centered modal) ── */
.action-dialog {
  background: #fff;
  border-radius: 20px;
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
  animation: dialog-pop 0.18s ease;
}

@keyframes dialog-pop {
  from { transform: scale(0.93); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.dialog-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #21313f;
  margin-bottom: 1rem;
  overflow-wrap: anywhere;
}

.dialog-body {
  color: #778697;
  font-size: 0.9rem;
  margin-bottom: 1.25rem;
}

.rename-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border: 1.5px solid #e2e8f0;
  font-size: 1rem;
  color: #21313f;
  margin-bottom: 1rem;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.rename-input:focus {
  border-color: #94a3b8;
}

.rename-input:disabled {
  opacity: 0.6;
}

.op-error {
  color: #dc2626;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.dialog-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
}

.dialog-btn {
  padding: 0.6rem 1.2rem;
  border: 0;
  border-radius: 10px;
  font-weight: 700;
  font-size: 0.9rem;
  background: #eef3f7;
  color: #475569;
  cursor: pointer;
  transition: background 0.15s;
  min-width: 80px;
}

.dialog-btn:hover:not(:disabled) {
  background: #e2e8f0;
}

.dialog-btn-primary {
  background: #2c2e33;
  color: #fff;
}

.dialog-btn-primary:hover:not(:disabled) {
  background: #1a1b1e;
}

.dialog-btn-danger {
  background: #dc2626;
  color: #fff;
}

.dialog-btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Preview modal ── */
.preview-overlay {
  align-items: center;
  padding: 1rem;
  transition: padding 0.2s ease;
}

.preview-overlay:has(.preview-dialog--fullscreen) {
  padding: 0;
}

.preview-dialog {
  background: #fff;
  border-radius: 12px;
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  height: 85vh;
  max-height: 90vh;
  animation: dialog-pop 0.18s ease;
  overflow: hidden;
  transition: height 0.2s ease, max-height 0.2s ease, border-radius 0.2s ease;
}

.preview-dialog--fullscreen {
  height: 100vh;
  max-height: 100vh;
  max-width: 100vw;
  border-radius: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  gap: 1rem;
  flex-shrink: 0;
}

.preview-title {
  font-size: 1rem;
  font-weight: 700;
  color: #21313f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.preview-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.preview-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  border: 0;
  background: #2c2e33;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}

.preview-action-btn:hover:not(:disabled) {
  background: #1a1b1e;
}

.preview-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-close-btn {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  font-size: 0.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.preview-close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.preview-body {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.preview-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  padding: 2rem;
  color: #617182;
  min-height: 220px;
}

.preview-progress-text {
  font-size: 0.85rem;
  color: #94a3b8;
  margin: 0;
}

.preview-image-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: #0d0d0d;
  min-height: 300px;
}

.preview-image {
  max-width: 100%;
  max-height: 72vh;
  object-fit: contain;
  border-radius: 6px;
}

.preview-audio-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1.25rem;
  padding: 3rem 2rem;
}

.audio-icon {
  font-size: 4rem;
  color: #94a3b8;
  line-height: 1;
}

.audio-name {
  font-weight: 600;
  color: #21313f;
  text-align: center;
  margin: 0;
  overflow-wrap: anywhere;
}

.preview-audio {
  width: 100%;
  max-width: 420px;
}

.preview-video-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0d0d;
  min-height: 300px;
}

.preview-video {
  width: 100%;
  max-width: 100%;
  max-height: 72vh;
}

.preview-dialog--fullscreen .preview-video-wrap {
  overflow: hidden;
}

.preview-dialog--fullscreen .preview-video {
  max-height: 100%;
  height: 100%;
  width: 100%;
  object-fit: contain;
}

.preview-pdf-wrap {
  flex: 1;
  display: flex;
  min-height: 60vh;
}

.preview-pdf {
  width: 100%;
  height: 100%;
  min-height: 60vh;
  border: 0;
}

.preview-text-wrap {
  flex: 1;
  overflow: auto;
  background: #272822;
  padding: 1.25rem;
}

.preview-text {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.65;
  color: #f8f8f2;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

/* ── Desktop grid view (≥ 768px) ── */
@media (min-width: 768px) {
  .embedded-explorer {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .explorer-shell {
    flex: 1;
    display: flex;
    flex-direction: column;
    max-width: none;
  }

  .explorer-grid {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .browser-card {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* Hide three-dot button on desktop; right-click context menu replaces it */
  .menu-btn {
    display: none;
  }

  .entry-list.grid-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
    gap: 0.2rem;
    flex: 1;
    max-height: none;
    align-content: start;
    padding: 0.35rem;
  }

  .entry-list.grid-view .entry-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 0.8rem 0.4rem 0.7rem;
    gap: 0.5rem;
    border: 1.5px solid transparent;
    border-radius: 10px;
    background: transparent;
    text-align: center;
    width: 100%;
    min-height: unset;
    /* reset hover effects from list view */
    transition: background 0.13s ease, border-color 0.13s ease;
  }

  .entry-list.grid-view .entry-row:hover {
    background: rgba(241, 245, 249, 0.9);
    border-color: rgba(0, 0, 0, 0.07);
    transform: none;
    box-shadow: none;
  }

  .entry-list.grid-view .entry-row.active {
    background: #dbeafe;
    border-color: rgba(59, 130, 246, 0.28);
    transform: none;
    box-shadow: none;
  }

  .entry-list.grid-view .entry-main {
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
  }

  .entry-list.grid-view .entry-icon {
    width: 52px;
    height: 52px;
    font-size: 1.65rem;
    border-radius: 12px;
    flex-shrink: 0;
  }

  .entry-list.grid-view .entry-name {
    font-size: 0.69rem;
    font-weight: 600;
    text-align: center;
    white-space: normal;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.35;
    max-width: 100%;
    word-break: break-word;
  }

  .entry-list.grid-view .entry-meta,
  .entry-list.grid-view .entry-side {
    display: none;
  }
}

/* ── Properties popup ── */
.properties-dialog {
  background: #fff;
  border-radius: 20px;
  width: 100%;
  max-width: 460px;
  animation: dialog-pop 0.18s ease;
  overflow: hidden;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.25rem 1rem;
  border-bottom: 1px solid #f1f5f9;
}

.properties-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  flex-shrink: 0;
}

.properties-title-wrap {
  flex: 1;
  min-width: 0;
}

.properties-name {
  font-size: 1rem;
  font-weight: 700;
  color: #1a2535;
  margin: 0 0 0.15rem;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.properties-kind {
  font-size: 0.78rem;
  color: #8896a4;
  font-weight: 500;
}

.properties-body {
  padding: 0.6rem 1.25rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.prop-row {
  display: flex;
  gap: 1rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
}

.prop-row:nth-child(odd) {
  background: #f8fafc;
}

.prop-label {
  flex: 0 0 90px;
  color: #7a8fa0;
  font-size: 0.8rem;
  font-weight: 600;
  padding-top: 1px;
}

.prop-value {
  flex: 1;
  color: #1e2f3e;
  font-size: 0.83rem;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.prop-mono {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.78rem;
}

.dl-toast {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 3000;
  background: #1e2a35;
  color: #e2e8f0;
  border-radius: 16px;
  padding: 1rem 1.1rem 0.9rem;
  width: 300px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.14);
}

.dl-toast-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.dl-toast-icon {
  font-size: 0.9rem;
  color: #60a5fa;
  flex-shrink: 0;
}

.dl-toast-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex: 1;
}

.dl-toast-cancel {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  font-size: 0.7rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.dl-toast-cancel:hover {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.dl-toast-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.65rem;
}

.dl-progress-bar-wrap {
  height: 5px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.dl-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 999px;
  transition: width 0.2s ease;
}

.dl-toast-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: #64748b;
  font-weight: 500;
}

</style>
