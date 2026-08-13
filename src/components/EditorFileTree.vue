<script setup lang="ts">
import { computed, provide, reactive, ref, shallowRef, watch } from 'vue'
import type { Session } from 'xconn'
import type { FileEntry } from '@/types'
import type { EncryptionKeys } from '@/utils/encryption'
import { createFileBrowser } from '@/utils/fileBrowse'
import { fetchGitStatus, type GitFileStatus } from '@/utils/git'
import { editorFileTreeActionsKey } from '@/composables/editorFileTreeActions'
import EditorFileTreeNode from '@/components/EditorFileTreeNode.vue'

const props = defineProps<{
  session: Session
  rootPath: string
  rootName: string
  keys: EncryptionKeys
}>()

const emit = defineEmits<{
  'open-file': [entry: FileEntry]
  'open-file-pinned': [entry: FileEntry]
}>()

const fileBrowser = shallowRef(createFileBrowser(props.session, () => props.keys))
const rootEntries = ref<FileEntry[]>([])
const rootError = ref('')
const rootLoading = ref(false)

const expanded = reactive(new Set<string>())
const childrenByPath = reactive(new Map<string, FileEntry[]>())
const loadingPaths = reactive(new Set<string>())
const statusByPath = ref(new Map<string, GitFileStatus>())

async function loadStatus() {
  try {
    const result = await fetchGitStatus(props.session, props.keys, props.rootPath)
    const map = new Map<string, GitFileStatus>()
    for (const entry of result.entries ?? []) map.set(entry.path, entry.status)
    statusByPath.value = map
  } catch {
    // Non-repo dirs, or a git-less remote — just render without red/neutral coloring.
    statusByPath.value = new Map()
  }
}

async function loadRoot() {
  rootLoading.value = true
  rootError.value = ''
  expanded.clear()
  childrenByPath.clear()
  try {
    const browse = await fileBrowser.value.browseFiles(props.rootPath)
    rootEntries.value = browse.entries ?? []
  } catch (err) {
    rootError.value = err instanceof Error ? err.message : 'Failed to open folder'
  } finally {
    rootLoading.value = false
  }
  void loadStatus()
}

watch(() => props.rootPath, loadRoot, { immediate: true })

async function toggleDir(path: string) {
  if (expanded.has(path)) {
    expanded.delete(path)
    return
  }
  expanded.add(path)
  if (childrenByPath.has(path)) return

  loadingPaths.add(path)
  try {
    const browse = await fileBrowser.value.browseFiles(path)
    childrenByPath.set(path, browse.entries ?? [])
  } catch {
    childrenByPath.set(path, [])
  } finally {
    loadingPaths.delete(path)
  }
}

provide(editorFileTreeActionsKey, {
  isExpanded: (path) => expanded.has(path),
  childrenOf: (path) => childrenByPath.get(path),
  isLoading: (path) => loadingPaths.has(path),
  statusOf: (path) => statusByPath.value.get(path),
  toggleDir,
  openFile: (entry) => emit('open-file', entry),
  openFilePinned: (entry) => emit('open-file-pinned', entry),
})

const rootStatus = computed(() => statusByPath.value.get(props.rootPath))
</script>

<template>
  <div class="file-tree">
    <div
      class="tree-root-label"
      :class="{
        'tree-row-untracked': rootStatus === 'untracked' || rootStatus === 'added',
        'tree-row-modified': rootStatus === 'modified',
        'tree-row-ignored': rootStatus === 'ignored',
      }"
    >
      <i class="bi bi-folder2-open tree-icon"></i>
      <span class="tree-name">{{ rootName }}</span>
      <button class="tree-refresh-btn" title="Refresh" @click="loadRoot">
        <i class="bi bi-arrow-clockwise"></i>
      </button>
    </div>

    <div v-if="rootLoading" class="tree-state">
      <span class="spinner-border spinner-border-sm" role="status"></span>
    </div>
    <div v-else-if="rootError" class="tree-state tree-error">{{ rootError }}</div>
    <div v-else class="tree-list">
      <EditorFileTreeNode
        v-for="entry in rootEntries"
        :key="entry.path"
        :entry="entry"
        :depth="0"
      />
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: #21211d;
}

.tree-root-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.6rem 0.6rem 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #a6a6a1;
  flex-shrink: 0;
}
.tree-root-label .tree-icon {
  color: #75a3d1;
  font-size: 0.85rem;
}
.tree-row-untracked {
  color: #f87171 !important;
}
.tree-row-untracked .tree-icon {
  color: #f87171 !important;
}
.tree-row-modified {
  color: #7fb4e0 !important;
}
.tree-row-modified .tree-icon {
  color: #7fb4e0 !important;
}
.tree-row-ignored {
  color: #f59e0b !important;
}
.tree-row-ignored .tree-icon {
  color: #f59e0b !important;
}

.tree-refresh-btn {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #8a8a85;
  font-size: 0.78rem;
  padding: 0.15rem;
  cursor: pointer;
  flex-shrink: 0;
}
.tree-refresh-btn:hover {
  color: #e2e2df;
}

.tree-list {
  flex: 1;
  min-height: 0;
  padding-bottom: 0.5rem;
}

.tree-state {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
  color: #8a8a85;
}
.tree-error {
  font-size: 0.75rem;
  padding: 0 0.75rem;
  color: #f87171;
  text-align: center;
}
</style>
