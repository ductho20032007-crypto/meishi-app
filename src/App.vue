<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BottomNav from './components/BottomNav.vue'
import Banner from './components/Banner.vue'
import { hasKeys } from './services/settings.js'
import { startStatus, stopStatus, syncNow } from './stores/status.js'

const route = useRoute()
const router = useRouter()
// bottom nav only on the 4 tab routes, and only once the device is set up
// (hasKeys() reads localStorage, so re-evaluate on every navigation)
const keyed = computed(() => { void route.fullPath; return hasKeys() })
const showNav = computed(() => route.meta.nav === true && keyed.value)

// never sync from #/setup: the setup view swaps the keys and starts its own run
const run = () => { if (hasKeys() && route.path !== '/setup') syncNow() }
const onVisible = () => { if (document.visibilityState === 'visible') run() }
onMounted(async () => {
  startStatus()
  await router.isReady()
  run()
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', run)
  document.removeEventListener('visibilitychange', onVisible)
  stopStatus()
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
