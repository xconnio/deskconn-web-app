<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { type Session } from 'xconn'

import { useSessionCacheStore } from '@/stores/sessionCache'
import { useMachinesStore } from '@/stores/machines'
import { useSettingsStore } from '@/stores/settings'
import WindowTitleBar from '@/components/WindowTitleBar.vue'
import FilePreviewModal from '@/components/FilePreviewModal.vue'
import { openLauncher } from '@/router/navigation'
import { useEntryNavigation } from '@/composables/useEntryNavigation'
import {
  createX25519KeyPair,
  deriveSessionKeys,
  encryptPayload,
  decryptPayload,
  type EncryptionKeys,
} from '@/utils/encryption'

const procedureKeyExchange = 'io.xconn.deskconn.deskconnd.key.exchange'
const procedureIndexQuery  = 'io.xconn.deskconn.deskconnd.index.query'

interface IndexEntry {
  path:      string
  name:      string
  category:  string
  size:      number
  mod_time:  string
  thumbnail?: string
}

interface IndexQueryResult {
  status:   'indexing' | 'ready'
  entries?: IndexEntry[]
}

type DocFilter = 'all' | 'pdf' | 'text' | 'json' | 'office'

const route             = useRoute()
const sessionCacheStore = useSessionCacheStore()
const machinesStore     = useMachinesStore()
const settingsStore     = useSettingsStore()

const realm       = computed(() => route.params.realm as string)
const category    = computed(() => route.params.category as string)
const desktopName = computed(() => {
  const n = route.query.name as string
  if (n) return n
  return machinesStore.desktops.find((d) => d.realm === realm.value)?.name ?? realm.value
})

const isConnecting  = ref(true)
const isLoading     = ref(false)
const error         = ref('')
const indexStatus   = ref<'indexing' | 'ready' | null>(null)
const entries       = ref<IndexEntry[]>([])
const docFilter     = ref<DocFilter>('all')
const selectedEntry = ref<IndexEntry | null>(null)
const entryListRef  = ref<HTMLElement | null>(null)
const isGridView    = ref(window.innerWidth >= 768)

const previewEntry = ref<IndexEntry | null>(null)
const previewSession = shallowRef<Session | null>(null)

const previewModalProps = computed(() =>
  previewEntry.value && previewSession.value
    ? { session: previewSession.value, entry: previewEntry.value }
    : null
)

function updateViewMode() { isGridView.value = window.innerWidth >= 768 }

const viewConfig = computed(() => {
  switch (category.value) {
    case 'pictures':
      return { title: 'Pictures',  icon: 'bi-images',                    color: '#ec4899', bg: '#fce7f3', backendCategory: 'images' as string | null }
    case 'videos':
      return { title: 'Videos',    icon: 'bi-collection-play-fill',       color: '#7c3aed', bg: '#ede9fe', backendCategory: 'videos' as string | null }
    default:
      return { title: 'Documents', icon: 'bi-file-earmark-richtext-fill', color: '#d97706', bg: '#fef3c7', backendCategory: null }
  }
})

const sortedEntries = computed(() =>
  [...entries.value].sort((a, b) => new Date(b.mod_time).getTime() - new Date(a.mod_time).getTime())
)

const docFilterCounts = computed(() => {
  const all = sortedEntries.value
  return {
    all:    all.length,
    pdf:    all.filter(e => e.category === 'pdfs').length,
    json:   all.filter(e => e.name.toLowerCase().endsWith('.json')).length,
    text:   all.filter(e => e.category === 'texts' && !e.name.toLowerCase().endsWith('.json')).length,
    office: all.filter(e => e.category === 'documents').length,
  }
})

const filteredDocEntries = computed(() => {
  const all = sortedEntries.value
  switch (docFilter.value) {
    case 'pdf':    return all.filter(e => e.category === 'pdfs')
    case 'json':   return all.filter(e => e.name.toLowerCase().endsWith('.json'))
    case 'text':   return all.filter(e => e.category === 'texts' && !e.name.toLowerCase().endsWith('.json'))
    case 'office': return all.filter(e => e.category === 'documents')
    default:       return all
  }
})

const displayEntries = computed(() =>
  category.value === 'documents' ? filteredDocEntries.value : sortedEntries.value
)

function openEntry(entry: IndexEntry) {
  if (!previewSession.value) return
  previewEntry.value = entry
}

const { handleNavKey } = useEntryNavigation({
  entries: () => displayEntries.value,
  selected: selectedEntry,
  listRef: entryListRef,
  isGrid: () => isGridView.value,
  onOpen: openEntry,
})

function handleKeydown(e: KeyboardEvent) {
  if (previewEntry.value) return  // FilePreviewModal owns Escape when open
  if (e.key === 'Escape') { openLauncher(realm.value, desktopName.value); return }
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
  handleNavKey(e)
}

function entryIconClass(entry: IndexEntry): string {
  if (entry.category === 'images') return 'bi-image-fill'
  if (entry.category === 'videos') return 'bi-file-earmark-play-fill'
  if (entry.category === 'pdfs')   return 'bi-file-earmark-pdf-fill'
  const ext = entry.name.toLowerCase().split('.').pop() || ''
  if (ext === 'json')                                        return 'bi-filetype-json'
  if (/^(yaml|yml|toml|xml|ini|cfg|env)$/.test(ext))       return 'bi-filetype-yml'
  if (/^(html|htm)$/.test(ext))                             return 'bi-filetype-html'
  if (ext === 'md')                                          return 'bi-file-earmark-text-fill'
  if (/^(doc|docx|odt|rtf|pages)$/.test(ext))              return 'bi-file-earmark-word-fill'
  if (/^(xls|xlsx|ods|numbers|csv)$/.test(ext))            return 'bi-file-earmark-spreadsheet-fill'
  if (/^(ppt|pptx|odp|key)$/.test(ext))                    return 'bi-file-earmark-slides-fill'
  if (ext === 'epub')                                        return 'bi-book-fill'
  return 'bi-file-earmark-text-fill'
}

function entryIconStyle(entry: IndexEntry): { color: string; background: string } {
  if (entry.category === 'images') return { color: '#ec4899', background: '#fce7f3' }
  if (entry.category === 'videos') return { color: '#7c3aed', background: '#ede9fe' }
  if (entry.category === 'pdfs')   return { color: '#ef4444', background: '#fee2e2' }
  const ext = entry.name.toLowerCase().split('.').pop() || ''
  if (ext === 'json')                                       return { color: '#10b981', background: '#d1fae5' }
  if (/^(yaml|yml|toml)$/.test(ext))                      return { color: '#34d399', background: '#ecfdf5' }
  if (/^(html|htm)$/.test(ext))                            return { color: '#f97316', background: '#ffedd5' }
  if (/^(doc|docx|odt|rtf|pages)$/.test(ext))            return { color: '#2563eb', background: '#dbeafe' }
  if (/^(xls|xlsx|ods|numbers|csv)$/.test(ext))          return { color: '#16a34a', background: '#dcfce7' }
  if (/^(ppt|pptx|odp|key)$/.test(ext))                  return { color: '#ea580c', background: '#ffedd5' }
  if (ext === 'epub')                                      return { color: '#7c3aed', background: '#ede9fe' }
  return { color: '#64748b', background: '#f1f5f9' }
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB']
  let v = size, i = -1
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d)
}

async function queryIndex(sess: Session, keys: EncryptionKeys, cat: string): Promise<IndexQueryResult> {
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ category: cat }))
  const encrypted    = encryptPayload(payloadBytes, keys.encryptKey)
  const result       = await sess.call(procedureIndexQuery, [encrypted])
  const enc          = result.args?.[0] as Uint8Array
  if (!enc?.length) throw new Error('Empty response from index service')
  const decrypted    = decryptPayload(enc, keys.decryptKey)
  return JSON.parse(new TextDecoder().decode(decrypted)) as IndexQueryResult
}

async function load() {
  isConnecting.value  = true
  isLoading.value     = false
  error.value         = ''
  indexStatus.value   = null
  entries.value       = []
  selectedEntry.value = null

  let sess: Session | null = null
  try {
    sess = await sessionCacheStore.acquire(realm.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not connect to desktop'
    isConnecting.value = false
    return
  }

  if (!sess) {
    error.value = 'Desktop is offline.'
    isConnecting.value = false
    return
  }

  previewSession.value = sess

  isConnecting.value = false
  isLoading.value    = true

  try {
    const { publicKey, privateKey } = createX25519KeyPair()
    const keyResult       = await sess.call(procedureKeyExchange, [publicKey])
    const serverPublicKey = keyResult.args?.[0] as Uint8Array
    if (!serverPublicKey?.length) throw new Error('Invalid key exchange response')
    const keys = await deriveSessionKeys(privateKey, serverPublicKey)

    const backendCat = viewConfig.value.backendCategory
    if (backendCat !== null) {
      const result  = await queryIndex(sess, keys, backendCat)
      indexStatus.value = result.status
      entries.value     = result.entries ?? []
    } else {
      const [pdfs, texts, docs] = await Promise.all([
        queryIndex(sess, keys, 'pdfs'),
        queryIndex(sess, keys, 'texts'),
        queryIndex(sess, keys, 'documents'),
      ])
      if (pdfs.status === 'indexing' || texts.status === 'indexing' || docs.status === 'indexing') {
        indexStatus.value = 'indexing'
      } else {
        indexStatus.value = 'ready'
        entries.value = [...(pdfs.entries ?? []), ...(texts.entries ?? []), ...(docs.entries ?? [])]
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('no_such_procedure')) {
      openLauncher(realm.value, desktopName.value, 'indexed-files')
      return
    }
    error.value = err instanceof Error ? err.message : 'Failed to load index'
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  window.addEventListener('resize', updateViewMode)
  document.addEventListener('keydown', handleKeydown)
  load()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateViewMode)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="indexed-view fade-in-up">

    <FilePreviewModal
      v-if="previewModalProps"
      :session="previewModalProps.session"
      :entry="previewModalProps.entry"
      @close="previewEntry = null"
    />

    <!-- ── Gallery (always mounted — modal overlays via position:fixed) ── -->
    <WindowTitleBar @close="openLauncher(realm, desktopName)">
        <div class="titlebar-content">
          <span class="titlebar-icon" :style="{ color: viewConfig.color, background: viewConfig.bg }">
            <i class="bi" :class="viewConfig.icon"></i>
          </span>
          <span class="titlebar-label">{{ viewConfig.title }}</span>
          <span class="titlebar-machine">{{ desktopName }}</span>
        </div>
      </WindowTitleBar>

      <div v-if="isConnecting || isLoading" class="state-center">
        <div class="pulse-ring" :style="{ background: viewConfig.bg }">
          <i class="bi" :class="viewConfig.icon" :style="{ color: viewConfig.color }"></i>
        </div>
        <p class="state-label">{{ isConnecting ? 'Connecting…' : 'Loading index…' }}</p>
      </div>

      <div v-else-if="error" class="state-center">
        <div class="state-icon error-icon"><i class="bi bi-exclamation-circle-fill"></i></div>
        <p class="state-label">{{ error }}</p>
        <button class="action-btn" @click="load">Try again</button>
      </div>

      <div v-else-if="indexStatus === 'indexing'" class="state-center">
        <div class="state-icon indexing-icon"><i class="bi bi-hourglass-split"></i></div>
        <p class="state-label">Still indexing your files…</p>
        <p class="state-sub">The desktop is still scanning. Check back in a moment.</p>
        <button class="action-btn" @click="load">Refresh</button>
      </div>

      <div v-else-if="indexStatus === 'ready'" class="content-area">

        <div v-if="category === 'documents'" class="chip-bar">
          <button
            v-for="chip in (['all', 'pdf', 'text', 'json', 'office'] as DocFilter[])"
            :key="chip"
            class="chip"
            :class="{ 'chip-active': docFilter === chip }"
            @click="docFilter = chip; selectedEntry = null"
          >
            {{ chip === 'all' ? 'All' : chip === 'pdf' ? 'PDF' : chip === 'text' ? 'Text' : chip === 'json' ? 'JSON' : 'Office' }}
            <span class="chip-count">{{ docFilterCounts[chip] }}</span>
          </button>
        </div>

        <div v-if="displayEntries.length === 0" class="state-center">
          <div class="state-icon" :style="{ background: viewConfig.bg, color: viewConfig.color }">
            <i class="bi" :class="viewConfig.icon"></i>
          </div>
          <p class="state-label">No files found.</p>
        </div>

        <div
          v-else
          ref="entryListRef"
          class="entry-list"
          :class="{ 'grid-view': isGridView }"
        >
          <button
            v-for="entry in displayEntries"
            :key="entry.path"
            class="entry-row"
            :class="{ active: selectedEntry?.path === entry.path }"
            @click="settingsStore.singleClickOpen ? openEntry(entry) : (isGridView ? selectedEntry = entry : openEntry(entry))"
            @dblclick="openEntry(entry)"
            @mouseenter="selectedEntry = entry"
            @mouseleave="selectedEntry = null"
          >
            <div class="entry-main">
              <span
                class="entry-icon"
                :class="{ 'entry-icon--thumb': !!entry.thumbnail }"
                :style="entry.thumbnail ? undefined : entryIconStyle(entry)"
              >
                <img
                  v-if="entry.thumbnail"
                  :src="`data:image/jpeg;base64,${entry.thumbnail}`"
                  class="entry-thumb"
                  :alt="entry.name"
                  loading="lazy"
                />
                <i v-else class="bi" :class="entryIconClass(entry)"></i>
                <span v-if="category === 'videos'" class="video-badge">
                  <i class="bi bi-play-fill"></i>
                </span>
              </span>
              <div class="entry-text">
                <div class="entry-name">{{ entry.name }}</div>
                <div class="entry-meta">{{ formatSize(entry.size) }} · {{ formatDate(entry.mod_time) }}</div>
              </div>
            </div>
            <div class="entry-side">
              <i class="bi bi-chevron-right entry-chevron"></i>
            </div>
          </button>
        </div>
      </div>
  </div>
</template>

<style scoped>
.indexed-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* ── Title bars ── */
.titlebar-content { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.titlebar-icon {
  width: 26px; height: 26px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.88rem; flex-shrink: 0;
}
.titlebar-label { font-weight: 700; font-size: 0.9rem; color: #1e293b; flex-shrink: 0; }
.titlebar-machine { font-size: 0.78rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titlebar-machine::before { content: '·'; margin-right: 0.35rem; }


/* ── State screens ── */
.state-center {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.75rem; padding: 2.5rem 1.5rem; text-align: center;
}
.pulse-ring {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%       { transform: scale(1.08); opacity: 0.72; }
}
.state-icon { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; }
.error-icon    { background: #fee2e2; color: #ef4444; }
.indexing-icon { background: #fef9ec; color: #d97706; animation: pulse 2s ease-in-out infinite; }
.state-label { font-size: 0.95rem; font-weight: 600; color: #334155; margin: 0; }
.state-sub   { font-size: 0.82rem; color: #94a3b8; margin: 0; max-width: 280px; }
.action-btn {
  padding: 0.4rem 1.2rem; border-radius: 8px; border: 1.5px solid #e2e8f0;
  background: #fff; font-size: 0.82rem; font-weight: 600; color: #334155;
  cursor: pointer; font-family: inherit; transition: background 0.13s, border-color 0.13s;
}
.action-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }

/* ── Content ── */
.content-area { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chip-bar { display: flex; gap: 0.4rem; padding: 0.6rem 0.85rem 0.5rem; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid #f1f5f9; flex-shrink: 0; }
.chip-bar::-webkit-scrollbar { display: none; }
.chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.28rem 0.7rem; border-radius: 20px; border: 1.5px solid #e2e8f0; background: #fff; font-size: 0.74rem; font-weight: 600; color: #475569; cursor: pointer; white-space: nowrap; font-family: inherit; transition: background 0.12s, border-color 0.12s, color 0.12s; }
.chip:hover { background: #f8fafc; border-color: #cbd5e1; }
.chip-active { background: #1e293b; border-color: #1e293b; color: #fff; }
.chip-active .chip-count { background: rgba(255,255,255,0.18); color: #fff; }
.chip-count { font-size: 0.67rem; font-weight: 700; background: #f1f5f9; color: #64748b; border-radius: 10px; padding: 0 0.35rem; line-height: 1.6; }

/* ── List view ── */
.entry-list { display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; padding: 0.75rem 1rem; flex: 1; }
.entry-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; width: 100%; text-align: left; border: 1px solid rgba(113,130,149,0.14); border-radius: 18px; background: #fff; padding: 0.95rem 1rem; cursor: pointer; font-family: inherit; transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }
.entry-row:hover, .entry-row.active { transform: translateY(-1px); border-color: rgba(0,0,0,0.2); box-shadow: 0 10px 24px rgba(71,85,105,0.08); }
.entry-main { display: flex; align-items: center; gap: 0.9rem; flex: 1; min-width: 0; }
.entry-side { display: flex; align-items: center; flex-shrink: 0; }
.entry-icon { width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center; border-radius: 14px; font-size: 1.15rem; flex: 0 0 auto; position: relative; }
.entry-icon--thumb { background: #111 !important; padding: 0; overflow: hidden; }
.entry-thumb { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: inherit; }
.video-badge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.35); border-radius: inherit; font-size: 0.85rem; color: rgba(255,255,255,0.9); pointer-events: none; }
.entry-text { min-width: 0; overflow: hidden; }
.entry-name { color: #21313f; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
.entry-meta { color: #778697; font-size: 0.8rem; white-space: nowrap; }
.entry-chevron { color: #cbd5e1; font-size: 0.75rem; }

/* ── Grid view (≥ 768 px) — identical to EmbeddedDesktopFiles ── */
@media (min-width: 768px) {
  .entry-list.grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 0.2rem; flex: 1; max-height: none; align-content: start; padding: 0.35rem; }
  .entry-list.grid-view .entry-row { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 0.8rem 0.4rem 0.7rem; gap: 0.5rem; border: 1.5px solid transparent; border-radius: 10px; background: transparent; text-align: center; width: 100%; min-height: unset; transition: background 0.13s ease, border-color 0.13s ease; }
  .entry-list.grid-view .entry-row:hover { background: rgba(241,245,249,0.9); border-color: rgba(0,0,0,0.07); transform: none; box-shadow: none; }
  .entry-list.grid-view .entry-row.active { background: #dbeafe; border-color: rgba(59,130,246,0.28); transform: none; box-shadow: none; }
  .entry-list.grid-view .entry-main { flex-direction: column; align-items: center; gap: 0.5rem; width: 100%; min-width: 0; }
  .entry-list.grid-view .entry-icon { width: 52px; height: 52px; font-size: 1.65rem; border-radius: 12px; flex-shrink: 0; }
  .entry-list.grid-view .entry-name { font-size: 0.69rem; font-weight: 600; text-align: center; white-space: normal; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.35; max-width: 100%; word-break: break-word; }
  .entry-list.grid-view .entry-meta, .entry-list.grid-view .entry-side { display: none; }
}
</style>
