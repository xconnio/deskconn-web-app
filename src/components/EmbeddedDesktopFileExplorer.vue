<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
const procedureFileRename = 'io.xconn.deskconn.deskconnd.file.rename'
const procedureFileDelete = 'io.xconn.deskconn.deskconnd.file.delete'
const procedureFileCopy = 'io.xconn.deskconn.deskconnd.file.copy'
const procedureFileDownload = 'io.xconn.deskconn.deskconnd.file.download'
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
const searchMode = ref(false)

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
const previewFileEntry = ref<FileEntry | null>(null)
const previewType = ref<FilePreviewType>('none')
const previewBlobUrl = ref('')
const previewTextContent = ref('')
const previewError = ref('')
const previewLoading = ref(false)
const previewExpectedBytes = ref(0)
const previewReceivedBytes = ref(0)

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

const hasEntryActions = computed(
  () =>
    supportedFileProcedures.value.rename ||
    supportedFileProcedures.value.delete ||
    supportedFileProcedures.value.copy,
)

const canDownload = computed(() => !!session.value)

function entryHasMenu(entry: FileEntry) {
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
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lowered)) return 'bi-image-fill'
  if (/\.(zip|tar|gz|xz|7z)$/.test(lowered)) return 'bi-file-earmark-zip-fill'
  if (/\.(json|yaml|yml|toml|xml|ini|conf|env)$/.test(lowered)) return 'bi-filetype-yml'
  if (/\.(md|txt|log)$/.test(lowered)) return 'bi-file-earmark-text-fill'

  return 'bi-file-earmark-fill'
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
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
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
  supportedFileProcedures.value = {
    rename: false,
    delete: false,
    copy: false,
  }
  clipboard.value = null
  closeActionSheet()
  closePreview()
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

  await detectFileOperationSupport()

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
  previewTextContent.value = ''
  previewError.value = ''
  previewLoading.value = false
  previewFileEntry.value = null
}

// Size limits for formats that must be fully buffered before display
const MAX_SIZE_IMAGE_PDF = 100 * 1024 * 1024  // 100 MB
const MAX_SIZE_AUDIO_FALLBACK = 50 * 1024 * 1024 // 50 MB (WAV/FLAC without MSE)
const MAX_SIZE_VIDEO_FALLBACK = 200 * 1024 * 1024 // 200 MB (formats without MSE)

// Returns the MSE MIME type to use for a file, or null if MSE is unsupported for that format.
function getMSEMimeType(name: string): string | null {
  if (!('MediaSource' in window)) return null
  const ext = name.toLowerCase().split('.').pop() || ''
  const candidates: Record<string, string[]> = {
    mp3:  ['audio/mpeg'],
    ogg:  ['audio/ogg; codecs=vorbis', 'audio/ogg; codecs=opus', 'audio/ogg'],
    opus: ['audio/ogg; codecs=opus'],
    aac:  ['audio/mp4; codecs="mp4a.40.2"'],
    m4a:  ['audio/mp4; codecs="mp4a.40.2"'],
    mp4:  ['video/mp4; codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4'],
    webm: ['video/webm; codecs="vp9,opus"', 'video/webm; codecs="vp8,vorbis"', 'video/webm'],
  }
  for (const mime of candidates[ext] ?? []) {
    if (MediaSource.isTypeSupported(mime)) return mime
  }
  return null
}

// Low-level stream: calls onChunk for each decrypted data chunk as it arrives.
async function streamFileData(
  remotePath: string,
  onChunk: (chunk: Uint8Array, expectedTotal: number) => void,
): Promise<void> {
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

  while (true) {
    if (queue.length === 0) {
      if (streamDone) break
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
      onChunk(chunk, expectedTotal)
    }
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
async function openWithMediaSource(entry: FileEntry, mseMime: string) {
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
        sourceBuffer.addEventListener('error', () => { isAppending = false })
      } catch { /* unsupported codec at runtime */ }
      resolve()
    }, { once: true })
  })

  try {
    await streamFileData(entry.path, (chunk, expectedTotal) => {
      if (previewFileEntry.value?.path !== entry.path) return
      if (expectedTotal > 0) previewExpectedBytes.value = expectedTotal
      previewReceivedBytes.value += chunk.length
      queue.push(chunk)
      drainQueue()
    })
    streamDone = true
    drainQueue()
  } catch (err) {
    if (previewFileEntry.value?.path === entry.path) {
      previewError.value = err instanceof Error ? err.message : 'Failed to stream file'
    }
  }
}

async function openFile(entry: FileEntry) {
  if (entry.is_dir) return
  selectEntry(entry)

  const pt = getFilePreviewType(entry.name)

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
    const mseMime = getMSEMimeType(entry.name)
    if (mseMime) {
      closePreview()
      await openWithMediaSource(entry, mseMime)
      return
    }
    // Fallback for WAV/FLAC/MOV etc. that MSE doesn't support: full-buffer with size guard
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
      const mime = getMimeType(entry.name)
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
  try {
    const data = await fetchFileData(entry.path)
    const mime = getMimeType(entry.name)
    const blob = new Blob([data.slice()], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    operationError.value = err instanceof Error ? err.message : 'Download failed'
  }
}

function downloadFromPreview() {
  if (!previewFileEntry.value) return
  const entry = previewFileEntry.value
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
  closePreview()
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

          <div
            class="breadcrumb-search-area"
            :class="{ 'breadcrumb-search-active': searchMode }"
            @click="!searchMode && enterSearchMode()"
          >
            <template v-if="!searchMode">
              <div class="breadcrumb-strip" v-if="breadcrumbSegments.length > 0">
                <template v-for="(segment, index) in breadcrumbSegments" :key="segment.path">
                  <button
                    class="breadcrumb-chip"
                    :class="{ 'breadcrumb-chip-current': index === breadcrumbSegments.length - 1 }"
                    @click.stop="loadPath(segment.path)"
                  >
                    {{ segment.label }}
                  </button>
                  <span v-if="index < breadcrumbSegments.length - 1" class="breadcrumb-sep">/</span>
                </template>
              </div>
              <i class="bi bi-search breadcrumb-search-hint"></i>
            </template>

            <form v-else class="path-input-inner" @submit.prevent="submitPath">
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
        <section class="browser-card">
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
              @dblclick="openFile(entry)"
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
        </section>

        <aside class="details-card">
          <div class="details-card-header">
            <p class="section-label mb-1">Properties</p>
            <h3 class="h5 mb-0 details-title">
              {{
                detailsTarget
                  ? ('name' in detailsTarget && detailsTarget.name
                      ? detailsTarget.name
                      : currentBrowse?.path?.split('/').pop() || 'Home')
                  : 'No item selected'
              }}
            </h3>
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

  <!-- Entry dropdown -->
  <div v-if="actionSheetVisible && actionSheetEntry && dropdownPos" class="dropdown-backdrop" @click="closeActionSheet">
    <div
      class="entry-dropdown"
      :style="`top: ${dropdownPos.top}px; right: ${dropdownPos.right}px`"
      @click.stop
    >
      <template v-if="actionSheetEntry && !actionSheetEntry.is_dir">
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
  <div v-if="previewVisible" class="fs-overlay preview-overlay" @click.self="closePreview">
    <div class="preview-dialog">
      <div class="preview-header">
        <span class="preview-title">{{ previewFileEntry?.name }}</span>
        <div class="preview-header-actions">
          <button
            class="preview-action-btn"
            @click="downloadFromPreview"
            :disabled="previewLoading"
          >
            <i class="bi bi-download"></i>Download
          </button>
          <button class="preview-close-btn" @click="closePreview">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      <div class="preview-body">
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
          <audio :src="previewBlobUrl" controls class="preview-audio" />
        </div>

        <!-- Video -->
        <div v-else-if="previewType === 'video' && previewBlobUrl" class="preview-video-wrap">
          <video :src="previewBlobUrl" controls class="preview-video" />
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
  grid-template-columns: auto 1fr;
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

.breadcrumb-search-area {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem;
  border-radius: 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  min-height: 52px;
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
}

.preview-dialog {
  background: #fff;
  border-radius: 20px;
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  animation: dialog-pop 0.18s ease;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
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
  max-width: 100%;
  max-height: 72vh;
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
  padding: 1.25rem;
}

.preview-text {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.65;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
</style>
