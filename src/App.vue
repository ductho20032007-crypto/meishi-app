<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Banner from './components/Banner.vue'
import { hasKeys } from './services/settings.js'
import { startStatus, syncNow } from './stores/status.js'

const route = useRoute()
// bottom nav only on the 4 tab routes, and only once the device is set up
// (hasKeys() reads localStorage, so re-evaluate on every navigation)
const keyed = computed(() => { void route.fullPath; return hasKeys() })
const showNav = computed(() => route.meta.nav === true && keyed.value)

const run = () => { if (hasKeys()) syncNow() }
const onVisible = () => { if (document.visibilityState === 'visible') run() }
onMounted(() => {
  startStatus()
  run()
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', run)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <Banner v-if="keyed" />
  <main :class="{ 'with-nav': showNav }">
    <RouterView />
  </main>
  <BottomNav v-if="showNav" />
</template>

<style scoped>
main { min-height: 100vh; min-height: 100dvh; }
main.with-nav { padding-bottom: calc(var(--nav-h) + var(--safe-bottom)); }
</style>
