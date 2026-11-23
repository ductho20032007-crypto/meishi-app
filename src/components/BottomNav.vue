<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

const { t } = useI18n()
const route = useRoute()
const TABS = [
  { to: '/', icon: 'cards', key: 'nav.cards', match: p => p === '/' || p === '/capture' || p.startsWith('/card/') },
  { to: '/companies', icon: 'building', key: 'nav.companies', match: p => p.startsWith('/compan') },
  { to: '/titles', icon: 'book', key: 'nav.titles', match: p => p.startsWith('/titles') },
  { to: '/settings', icon: 'sliders', key: 'nav.settings', match: p => p.startsWith('/settings') }
]
const active = computed(() => TABS.find(x => x.match(route.path))?.to)
</script>

<template>
  <nav class="nav" :aria-label="t('nav.label')">
    <RouterLink v-for="tab in TABS" :key="tab.to" :to="tab.to" :class="{ on: active === tab.to }"
      :aria-current="active === tab.to ? 'page' : undefined">
      <Icon :name="tab.icon" />
      <span>{{ t(tab.key) }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.nav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  display: flex; padding: 6px calc(8px + var(--safe-right)) calc(6px + var(--safe-bottom)) calc(8px + var(--safe-left));
  background: var(--surface); border-top: 1px solid var(--line);
}
.nav a {
  flex: 1; min-width: 0; min-height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  font-size: 11px; font-weight: 500; color: var(--muted); text-decoration: none; border-radius: 10px;
}
.nav a span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav a.on { color: var(--accent); font-weight: 600; }
</style>
