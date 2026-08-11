<script setup lang="ts">
/**
 * Plain-text editor window. Streams content via file.cat (fileCat.ts) and saves
 * via file.edit as a diff-match-patch patch (see fileexplorer.go).
 */
import { ref, computed, inject, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { type Session } from 'xconn'
import { floatingWindowActionsKey } from '@/composables/floatingWindowToolbar'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useSessionCacheStore } from '@/stores/sessionCache'
import { useSessionEncryptionStore } from '@/stores/sessionEncryption'
import { streamFileCat } from '@/utils/fileCat'
import { buildEditPatch } from '@/utils/textPatch'
import { downloadBlob } from '@/utils/download'
import { encryptPayload, decryptPayload } from '@/utils/encryption'
import { formatSize } from '@/utils/fileTypes'
import { formatDesktopError, isDesktopOfflineError, isEditConflictError } from '@/utils/desktopError'

const procedureFileEdit = 'io.xconn.deskconn.deskconnd.file.edit'
const MAX_EDIT_SIZE = 10 * 1024 * 1024

type TextEntry = { path: string; name: string; size: number }

const props = defineProps<{
  session: Session
  realm: string
  entry: TextEntry
  focused?: boolean
}>()

const emit = defineEmits<{ 'update-title': [title: string] }>()

// Absent when there's no FloatingWindow ancestor — the Save button then
// renders inline instead of teleporting into the window's titlebar.
const actionsHostRef = inject(floatingWindowActionsKey)
const actionsTarget = computed(() => actionsHostRef?.value ?? null)

const sessionEncryptionStore = useSessionEncryptionStore()
const sessionCacheStore = useSessionCacheStore()

const content = ref('')
const originalContent = ref('')
const loading = ref(true)
const loadedBytes = ref(0)
const loadError = ref('')
const saving = ref(false)
const saveError = ref('')
const saveConflict = ref(false)
const savedFlash = ref(false)

const dirty = computed(() => content.value !== originalContent.value)

const gutterEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)

function syncGutterScroll() {
  if (gutterEl.value && textareaEl.value) gutterEl.value.scrollTop = textareaEl.value.scrollTop
}

// Word wrap means a single logical line can span several visual rows, so the
// gutter can no longer just be "one number per line" — it has to know how
// many rows each line actually wrapped to (blank-padding the rest) or the
// numbers drift out of sync with the text below the first wrapped line.
// There's no DOM API for a textarea's wrap points, so this simulates the
// same greedy word-wrap the browser does, measuring with a canvas context
// using the textarea's own computed font (so widths match exactly).
const availableWidth = ref(0)
let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx || !textareaEl.value) return measureCtx
  const canvas = document.createElement('canvas')
  measureCtx = canvas.getContext('2d')
  if (measureCtx) {
    const style = window.getComputedStyle(textareaEl.value)
    measureCtx.font = `${style.fontSize} ${style.fontFamily}`
  }
  return measureCtx
}

// Tabs are expanded to spaces (matching CSS tab-size: 4) since canvas
// measureText doesn't know about tab-size and would otherwise measure them
// as near-zero width, undercounting how much room a line actually takes.
function wrappedRowCount(line: string, ctx: CanvasRenderingContext2D, maxWidth: number): number {
  if (maxWidth <= 0) return 1
  const expanded = line.replace(/\t/g, '    ')
  if (expanded === '') return 1

  let rows = 1
  let rowWidth = 0
  for (const token of expanded.split(/(\s+)/)) {
    if (token === '') continue
    const tokenWidth = ctx.measureText(token).width
    if (rowWidth > 0 && rowWidth + tokenWidth > maxWidth) {
      rows++
      rowWidth = 0
    }
    if (tokenWidth > maxWidth) {
      // Longer than a full row on its own (e.g. a long URL) — it wraps
      // again on its own once overflow-wrap kicks in.
      rows += Math.floor(tokenWidth / maxWidth)
      rowWidth = tokenWidth % maxWidth
    } else {
      rowWidth += tokenWidth
    }
  }
  return rows
}

// One text node with all line numbers, rather than one DOM element per line —
// cheap even for a file with tens of thousands of lines.
const gutterText = computed(() => {
  const lines = content.value.split('\n')
  const ctx = getMeasureCtx()
  let s = ''
  for (let i = 0; i < lines.length; i++) {
    const rows = ctx ? wrappedRowCount(lines[i]!, ctx, availableWidth.value) : 1
    s += (i + 1) + '\n'.repeat(rows)
  }
  return s
})

let resizeObserver: ResizeObserver | null = null

function updateAvailableWidth() {
  const textarea = textareaEl.value
  if (!textarea) return
  const style = window.getComputedStyle(textarea)
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  availableWidth.value = textarea.clientWidth - padding
}

// Tab/Shift+Tab indent or outdent instead of shifting focus off the textarea.
function handleTextareaKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const textarea = textareaEl.value
  if (!textarea) return
  e.preventDefault()

  const value = content.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd

  if (!e.shiftKey && start === end) {
    content.value = value.slice(0, start) + '\t' + value.slice(end)
    nextTick(() => { textarea.selectionStart = textarea.selectionEnd = start + 1 })
    return
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndSearch = value.indexOf('\n', end)
  const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch
  const selectedLines = value.slice(lineStart, lineEnd).split('\n')

  if (!e.shiftKey) {
    const indented = selectedLines.map((line) => '\t' + line).join('\n')
    content.value = value.slice(0, lineStart) + indented + value.slice(lineEnd)
    nextTick(() => {
      textarea.selectionStart = start + 1
      textarea.selectionEnd = end + indented.length - (lineEnd - lineStart)
    })
    return
  }

  let firstLineRemoved = 0
  let totalRemoved = 0
  const outdented = selectedLines.map((line, i) => {
    const tabMatch = line.startsWith('\t')
    const spaceMatch = !tabMatch && /^ {1,4}/.exec(line)
    const removed = tabMatch ? 1 : spaceMatch ? spaceMatch[0].length : 0
    if (i === 0) firstLineRemoved = removed
    totalRemoved += removed
    return line.slice(removed)
  }).join('\n')

  content.value = value.slice(0, lineStart) + outdented + value.slice(lineEnd)
  nextTick(() => {
    textarea.selectionStart = Math.max(lineStart, start - firstLineRemoved)
    textarea.selectionEnd = Math.max(textarea.selectionStart, end - totalRemoved)
  })
}

let loadController: AbortController | null = null
let mounted = true
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null

watch(dirty, (isDirty) => {
  emit('update-title', isDirty ? `${props.entry.name} •` : props.entry.name)
})

async function loadFile() {
  loading.value = true
  loadError.value = ''
  loadedBytes.value = 0
  content.value = ''

  if (props.entry.size > MAX_EDIT_SIZE) {
    loadError.value = `File is too large to edit (max ${formatSize(MAX_EDIT_SIZE)}).`
    loading.value = false
    return
  }

  loadController = new AbortController()
  const decoder = new TextDecoder('utf-8', { fatal: false })

  try {
    await streamFileCat(props.session, props.entry.path, (chunk) => {
      loadedBytes.value += chunk.length
      content.value += decoder.decode(chunk, { stream: true })
    }, loadController.signal)
    content.value += decoder.decode()
    if (!mounted) return
    originalContent.value = content.value
  } catch (err) {
    if (mounted) loadError.value = err instanceof Error ? err.message : 'Failed to load file'
  } finally {
    if (mounted) loading.value = false
  }
}

function downloadFile() {
  downloadBlob(new Blob([content.value], { type: 'text/plain' }), props.entry.name)
}

async function saveFile() {
  if (!dirty.value || saving.value) return
  saving.value = true
  saveError.value = ''
  saveConflict.value = false

  try {
    const patch = buildEditPatch(originalContent.value, content.value)
    const keys = await sessionEncryptionStore.getOrExchange(props.session, props.realm)
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ path: props.entry.path, patch }))
    const encrypted = encryptPayload(payloadBytes, keys.encryptKey)

    const result = await props.session.call(procedureFileEdit, [encrypted])
    const encryptedResult = result.args?.[0]
    if (encryptedResult) decryptPayload(encryptedResult as Uint8Array, keys.decryptKey)

    originalContent.value = content.value
    savedFlash.value = true
    if (savedFlashTimer) clearTimeout(savedFlashTimer)
    savedFlashTimer = setTimeout(() => { savedFlash.value = false }, 1800)
  } catch (err) {
    saveConflict.value = isEditConflictError(err)
    if (isDesktopOfflineError(err)) sessionCacheStore.reportUnreachable(props.realm)
    saveError.value = formatDesktopError(err, 'Failed to save file')
  } finally {
    saving.value = false
  }
}

// Called by DesktopSessionHost before it unmounts this window (see
// TerminalPanel's requestClose for the same pattern) — takes over from the
// browser's native confirm() dialog so the app gets its own themed one.
const pendingCloseResolve = ref<((ok: boolean) => void) | null>(null)

function requestClose(): Promise<boolean> {
  if (!dirty.value) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    pendingCloseResolve.value = resolve
  })
}

defineExpose({ requestClose })

function confirmClose() {
  pendingCloseResolve.value?.(true)
  pendingCloseResolve.value = null
}

function cancelClose() {
  pendingCloseResolve.value?.(false)
  pendingCloseResolve.value = null
}

async function reloadFromDevice() {
  if (dirty.value && !window.confirm('Reload will discard your unsaved changes. Continue?')) return
  loadController?.abort()
  saveError.value = ''
  saveConflict.value = false
  await loadFile()
}

function handleKeydown(e: KeyboardEvent) {
  if (!props.focused) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveFile()
  }
}

// The textarea unmounts/remounts across loading states (spinner ↔ editor),
// so its width is tracked via a ref watcher rather than a one-time mount
// hook — this reattaches the observer whenever a new textarea element shows up.
watch(textareaEl, (el) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!el) return
  updateAvailableWidth()
  resizeObserver = new ResizeObserver(updateAvailableWidth)
  resizeObserver.observe(el)
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  loadFile()
})

onUnmounted(() => {
  mounted = false
  document.removeEventListener('keydown', handleKeydown)
  loadController?.abort()
  if (savedFlashTimer) clearTimeout(savedFlashTimer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="editor-window">
    <Teleport :to="actionsTarget ?? 'body'" :disabled="!actionsTarget">
      <span v-if="dirty && !loading" class="editor-dirty-dot" title="Unsaved changes"></span>
      <button
        class="editor-action-btn"
        @click="saveFile"
        :disabled="!dirty || saving || loading"
        title="Save (Ctrl+S)"
      >
        <i class="bi" :class="saving ? 'bi-hourglass-split' : 'bi-save'"></i>
      </button>
      <button
        class="editor-action-btn"
        @click="downloadFile"
        :disabled="loading || !!loadError"
        title="Download"
      >
        <i class="bi bi-download"></i>
      </button>
    </Teleport>

    <div v-if="loading" class="editor-state">
      <div class="spinner-border mb-3" role="status"><span class="visually-hidden">Loading…</span></div>
      <p class="editor-progress-text">{{ formatSize(loadedBytes) }} / {{ formatSize(entry.size) }}</p>
    </div>

    <div v-else-if="loadError" class="editor-state">
      <i class="bi bi-exclamation-octagon display-6 mb-3"></i>
      <p class="mb-0">{{ loadError }}</p>
    </div>

    <template v-else>
      <div v-if="saveError" class="editor-error-banner">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <span class="editor-error-text">{{ saveError }}</span>
        <button v-if="saveConflict" class="editor-error-action" @click="reloadFromDevice">Reload from device</button>
        <button class="editor-error-dismiss" @click="saveError = ''" title="Dismiss">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
      <div class="editor-body">
        <div ref="gutterEl" class="editor-gutter"><div class="editor-gutter-inner">{{ gutterText }}</div></div>
        <textarea
          ref="textareaEl"
          v-model="content"
          class="editor-textarea"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          wrap="soft"
          @scroll="syncGutterScroll"
          @keydown="handleTextareaKeydown"
        ></textarea>
      </div>
    </template>

    <ConfirmDialog
      :open="!!pendingCloseResolve"
      title="Unsaved changes"
      :message="`${entry.name} has unsaved changes. Close this window anyway?`"
      confirm-label="Close"
      @confirm="confirmClose"
      @cancel="cancelClose"
    />
  </div>

  <Teleport to="body">
    <Transition name="dl-toast">
      <div v-if="savedFlash" class="editor-saved-toast"><i class="bi bi-check-circle-fill"></i> Saved</div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.editor-window {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

/* Teleported into the FloatingWindow's titlebar, beside minimize/maximize/close. */
.editor-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
}

.editor-action-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid #d9dee4;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  font-size: 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.editor-action-btn:hover:not(:disabled) { background: #e2e8f0; color: #111827; }
.editor-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.editor-state {
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
.editor-progress-text { font-size: 0.85rem; color: #94a3b8; margin: 0; }

.editor-error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
  color: #991b1b;
  font-size: 0.8rem;
  flex-shrink: 0;
}
.editor-error-text { flex: 1; min-width: 0; }
.editor-error-action {
  border: 1px solid #fca5a5;
  border-radius: 6px;
  background: #fff;
  color: #991b1b;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  flex-shrink: 0;
}
.editor-error-action:hover { background: #fee2e2; }
.editor-error-dismiss {
  border: 0;
  background: transparent;
  color: #991b1b;
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
}

.editor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: #272822;
}

/* Font/line-height/padding-top must match .editor-textarea for line numbers to align. */
.editor-gutter {
  flex-shrink: 0;
  overflow: hidden;
  padding: 1rem 0.75rem 1rem 1rem;
  text-align: right;
  user-select: none;
  background: #272822;
  border-right: 1px solid #3e3d32;
}
.editor-gutter-inner {
  white-space: pre;
  font-size: 0.85rem;
  line-height: 1.6;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  color: #75715e;
}

.editor-textarea {
  flex: 1;
  min-height: 0;
  min-width: 0;
  border: 0;
  outline: none;
  resize: none;
  padding: 1rem 1.25rem;
  background: #272822;
  color: #f8f8f2;
  font-size: 0.85rem;
  line-height: 1.6;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  overflow: auto;
  overflow-x: hidden;
}

.editor-saved-toast {
  position: fixed;
  bottom: 1.25rem;
  right: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: #16a34a;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.55rem 0.9rem;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  z-index: 3000;
}
</style>
