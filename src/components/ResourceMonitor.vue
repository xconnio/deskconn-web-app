<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useSessionCacheStore } from '../stores/sessionCache'
import { useSettingsStore } from '../stores/settings'
import { formatDesktopError } from '../utils/desktopError'

const props = defineProps<{
  realm: string
  desktopName?: string
  focused?: boolean
}>()

const sessionCacheStore = useSessionCacheStore()
const settingsStore = useSettingsStore()

interface NetworkInterface {
  name: string
  bytes_sent_ps: number
  bytes_recv_ps: number
}

interface CPUTimes {
  user: number
  system: number
  nice: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
}

interface DeviceInfo {
  cpu_model: string
  cpu_physical: number
  cpu_logical: number
  cpu_usages: number[]
  cpu_times: CPUTimes
  ram_total: number
  ram_free: number
  ram_used: number
  ram_buff_cache: number
  ram_available: number
  swap_total: number
  swap_free: number
  swap_used: number
  disk_used: number
  disk_free: number
  disk_total: number
  network_interfaces: NetworkInterface[]
}

const info = ref<DeviceInfo | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
let intervalId: ReturnType<typeof setInterval> | null = null

async function fetchInfo() {
  try {
    const session = await sessionCacheStore.acquire(props.realm)
    if (!session) {
      error.value = 'No session available'
      return
    }
    const result = await session.call('io.xconn.deskconn.deskconnd.device.info')
    const bytes = result.args?.[0] as Uint8Array
    info.value = JSON.parse(new TextDecoder().decode(bytes)) as DeviceInfo
    error.value = null
  } catch (e) {
    error.value = formatDesktopError(e)
  } finally {
    loading.value = false
  }
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function startPolling() {
  stopPolling()
  fetchInfo()
  intervalId = setInterval(fetchInfo, settingsStore.resourceMonitorInterval * 1000)
}

watch(
  () => settingsStore.resourceMonitorInterval,
  () => {
    startPolling()
  },
)

onMounted(startPolling)
onUnmounted(stopPolling)

function formatBytes(b: number): string {
  const unit = 1000
  if (b < unit) return `${b.toFixed(0)} B`
  if (b < unit * unit) return `${(b / unit).toFixed(1)} KB`
  if (b < unit * unit * unit) return `${(b / unit / unit).toFixed(1)} MB`
  return `${(b / unit / unit / unit).toFixed(2)} GB`
}

function formatBytesPS(bps: number): string {
  return formatBytes(bps) + '/s'
}

const cpuOverall = computed(() => {
  const usages = info.value?.cpu_usages
  if (!usages?.length) return 0
  return usages.reduce((a, b) => a + b, 0) / usages.length
})

function cpuColor(pct: number): string {
  if (pct < 50) return '#22c55e'
  if (pct < 80) return '#f59e0b'
  return '#ef4444'
}

function ramUsedPct(): number {
  if (!info.value?.ram_total) return 0
  return ((info.value.ram_total - info.value.ram_available) / info.value.ram_total) * 100
}

function swapUsedPct(): number {
  if (!info.value?.swap_total) return 0
  return (info.value.swap_used / info.value.swap_total) * 100
}

function diskUsedPct(): number {
  if (!info.value?.disk_total) return 0
  return (info.value.disk_used / info.value.disk_total) * 100
}
</script>

<template>
  <div class="resource-monitor">
    <div v-if="loading" class="rm-loading">
      <div class="spinner-border spinner-border-sm text-secondary" role="status"></div>
      <span>Loading stats…</span>
    </div>

    <div v-else-if="error" class="rm-error">
      <i class="bi bi-exclamation-triangle-fill"></i>
      {{ error }}
    </div>

    <template v-else-if="info">
      <!-- CPU -->
      <section class="rm-section">
        <div class="rm-section-header">
          <span class="rm-section-title"><i class="bi bi-cpu"></i> CPU</span>
          <span class="rm-section-badge">{{ info.cpu_physical }}P / {{ info.cpu_logical }}L</span>
          <span class="rm-section-value" :style="{ color: cpuColor(cpuOverall) }">
            {{ cpuOverall.toFixed(1) }}%
          </span>
        </div>
        <p v-if="info.cpu_model" class="rm-model-name">{{ info.cpu_model }}</p>
        <div class="rm-bar">
          <div
            class="rm-bar-fill"
            :style="{ width: cpuOverall + '%', background: cpuColor(cpuOverall) }"
          ></div>
        </div>
        <div class="rm-cores-grid">
          <div v-for="(usage, i) in info.cpu_usages" :key="i" class="rm-core-row">
            <span class="rm-core-label">CPU {{ i }}</span>
            <div class="rm-core-track">
              <div
                class="rm-core-fill"
                :style="{ width: usage + '%', background: cpuColor(usage) }"
              ></div>
            </div>
            <span class="rm-core-pct" :style="{ color: cpuColor(usage) }"
              >{{ usage.toFixed(0) }}%</span
            >
          </div>
        </div>
      </section>

      <!-- Memory -->
      <section class="rm-section">
        <div class="rm-section-header">
          <span class="rm-section-title"><i class="bi bi-memory"></i> Memory</span>
          <span class="rm-section-value rm-value--blue">
            {{ formatBytes(info.ram_total - info.ram_available) }} /
            {{ formatBytes(info.ram_total) }}
          </span>
        </div>
        <div class="rm-bar">
          <div class="rm-bar-fill rm-bar-fill--blue" :style="{ width: ramUsedPct() + '%' }"></div>
        </div>
        <div class="rm-detail-row">
          <span>Available: {{ formatBytes(info.ram_available) }}</span>
          <span>Buff/Cache: {{ formatBytes(info.ram_buff_cache) }}</span>
        </div>
        <div v-if="info.swap_total > 0" class="rm-swap-row">
          <span class="rm-swap-label">Swap</span>
          <div class="rm-bar rm-bar--thin">
            <div
              class="rm-bar-fill rm-bar-fill--violet"
              :style="{ width: swapUsedPct() + '%' }"
            ></div>
          </div>
          <span class="rm-swap-val"
            >{{ formatBytes(info.swap_used) }} / {{ formatBytes(info.swap_total) }}</span
          >
        </div>
      </section>

      <!-- Disk -->
      <section class="rm-section">
        <div class="rm-section-header">
          <span class="rm-section-title"><i class="bi bi-hdd"></i> Disk (/)</span>
          <span class="rm-section-value rm-value--violet">
            {{ formatBytes(info.disk_used) }} / {{ formatBytes(info.disk_total) }}
          </span>
        </div>
        <div class="rm-bar">
          <div
            class="rm-bar-fill rm-bar-fill--violet"
            :style="{ width: diskUsedPct() + '%' }"
          ></div>
        </div>
        <div class="rm-detail-row">
          <span>Free: {{ formatBytes(info.disk_free) }}</span>
          <span>Used: {{ diskUsedPct().toFixed(1) }}%</span>
        </div>
      </section>

      <!-- Network -->
      <section v-if="info.network_interfaces?.length" class="rm-section rm-section--last">
        <div class="rm-section-header">
          <span class="rm-section-title"><i class="bi bi-diagram-3"></i> Network</span>
        </div>
        <div class="rm-net-list">
          <div v-for="iface in info.network_interfaces" :key="iface.name" class="rm-net-row">
            <span class="rm-net-name">{{ iface.name }}</span>
            <span class="rm-net-stat rm-net-up">
              <i class="bi bi-arrow-up-short"></i>{{ formatBytesPS(iface.bytes_sent_ps) }}
            </span>
            <span class="rm-net-stat rm-net-down">
              <i class="bi bi-arrow-down-short"></i>{{ formatBytesPS(iface.bytes_recv_ps) }}
            </span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.resource-monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 0.75rem;
  background: #f8fafc;
  gap: 0;
}

.rm-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  flex: 1;
  color: #64748b;
  font-size: 0.85rem;
}

.rm-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex: 1;
  color: #b45309;
  font-size: 0.85rem;
}

.rm-section {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
  margin-bottom: 0.55rem;
}

.rm-section--last {
  margin-bottom: 0;
}

.rm-section-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.45rem;
}

.rm-section-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: 1;
}

.rm-section-title .bi {
  font-size: 0.85rem;
  color: #64748b;
}

.rm-section-badge {
  font-size: 0.65rem;
  font-weight: 600;
  color: #94a3b8;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 6px;
}

.rm-section-value {
  font-size: 0.75rem;
  font-weight: 700;
  color: #334155;
}

.rm-value--blue {
  color: #2563eb;
}
.rm-value--violet {
  color: #7c3aed;
}

.rm-model-name {
  font-size: 0.65rem;
  color: #94a3b8;
  margin: 0 0 0.4rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rm-bar {
  height: 18px;
  background: #e2e8f0;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 0.4rem;
}

.rm-bar--thin {
  height: 5px;
  flex: 1;
  margin-bottom: 0;
}

.rm-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}

.rm-bar-fill--blue {
  background: #3b82f6;
}
.rm-bar-fill--violet {
  background: #8b5cf6;
}

.rm-cores-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 14px;
  margin-top: 0.5rem;
}

.rm-core-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rm-core-label {
  font-size: 0.67rem;
  font-weight: 600;
  color: #64748b;
  min-width: 36px;
  flex-shrink: 0;
}

.rm-core-track {
  flex: 1;
  height: 14px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
}

.rm-core-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.rm-core-pct {
  font-size: 0.67rem;
  font-weight: 700;
  min-width: 30px;
  text-align: right;
  flex-shrink: 0;
}

.rm-detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  color: #94a3b8;
  margin-top: 0.1rem;
}

.rm-swap-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.rm-swap-label {
  font-size: 0.65rem;
  font-weight: 600;
  color: #94a3b8;
  flex-shrink: 0;
}

.rm-swap-val {
  font-size: 0.65rem;
  color: #94a3b8;
  flex-shrink: 0;
}

.rm-net-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.rm-net-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rm-net-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: #334155;
  min-width: 60px;
  font-family: monospace;
}

.rm-net-stat {
  font-size: 0.68rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 80px;
}

.rm-net-up {
  color: #0891b2;
}

.rm-net-down {
  color: #059669;
}
</style>
