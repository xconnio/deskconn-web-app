<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const notSupported = computed(() => !!route.query.notSupported)
function dismissNotSupported() {
  const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== 'notSupported'))
  router.replace({ params: route.params, query: rest })
}
</script>

<template>
  <div v-if="notSupported" class="not-supported-banner">
    <i class="bi bi-exclamation-triangle-fill"></i>
    <span>Not supported — please upgrade your backend.</span>
    <button class="not-supported-dismiss" @click="dismissNotSupported">×</button>
  </div>
</template>

<style scoped>
.not-supported-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 1rem;
  background: #fef3c7;
  border-bottom: 1px solid #fbbf24;
  color: #92400e;
  font-size: 0.8rem;
  font-weight: 500;
}

.not-supported-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: #92400e;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0;
}
</style>
