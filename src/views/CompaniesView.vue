<script setup>
// ⑤ Companies — initial tile, name, counts; search on name + aliases; row -> org chart.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { db } from '../services/db.js'
import { useLive } from '../composables/useLive.js'
import { companyInitial, companyTint, companyStats, filterCompanies } from '../lib/orgView.js'

const { t } = useI18n()
const companies = useLive(() => db.companies.toArray(), null)
const cards = useLive(() => db.cards.toArray(), [])
const ui = companiesUi

const all = computed(() => companies.value || [])
const shown = computed(() => filterCompanies(all.value, ui.q).map(co => {
  const s = companyStats(co, cards.value)
  const meta = [t('list.cards', s.cards)]
  if (s.notMet) meta.push(t('companies.notMet', s.notMet))
  if (s.pending) meta.push(t('companies.pending', s.pending))
  return { co, initial: companyInitial(co.name), ...companyTint(co.id), meta: meta.join(' · ') }
}))
</script>

<script>
import { reactive } from 'vue'
// search survives navigating into a company and back (module scope, per session)
const companiesUi = reactive({ q: '' })
</script>

<template>
  <div class="page companies">
    <header class="head">
      <div class="ttl">
        <h1 class="h1">{{ t('companies.title') }}</h1>
        <span class="sub">{{ t('companies.sub') }}</span>
      </div>
      <label v-if="all.length" class="search">
        <span class="visually-hidden">{{ t('companies.searchLabel') }}</span>
        <Icon name="search" :size="20" class="s-ico" />
        <input v-model="ui.q" type="search" class="s-inp" :placeholder="t('companies.search')" enterkeyhint="search" autocomplete="off">
      </label>
    </header>

    <template v-if="companies">
      <div v-if="!all.length" class="empty">
        <span class="empty-ico" aria-hidden="true"><Icon name="building" :size="34" /></span>
        <h2 class="empty-t">{{ t('companies.emptyTitle') }}</h2>
        <p class="hint center">{{ t('companies.emptyBody') }}</p>
      </div>
      <template v-else>
        <ul v-if="shown.length" class="rows">
          <li v-for="r in shown" :key="r.co.id">
            <RouterLink :to="`/company/${r.co.id}`" class="row">
              <span class="tile" :style="{ background: r.tint, color: r.ink }" aria-hidden="true">{{ r.initial }}</span>
              <span class="txt">
                <span class="name">{{ r.co.name }}</span>
                <span class="meta">{{ r.meta }}</span>
              </span>
              <Icon name="tree" :size="20" class="go" />
            </RouterLink>
          </li>
        </ul>
        <div v-else class="nomatch">
          <p class="hint center">{{ t('companies.noMatch') }}</p>
          <button type="button" class="btn" @click="ui.q = ''">{{ t('companies.clear') }}</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.companies { padding-top: 0; }
.head { padding: calc(20px + var(--safe-top)) 16px 14px; display: flex; flex-direction: column; gap: 14px; }
:global(.banner-on) .head { padding-top: 20px; }
.ttl { display: flex; flex-direction: column; gap: 2px; }
.h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.sub { font-size: 13px; color: var(--muted); }
.search { position: relative; display: block; }
.s-ico { position: absolute; left: 14px; top: 13px; color: var(--muted); pointer-events: none; }
.s-inp {
  width: 100%; height: 46px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface);
  padding: 0 14px 0 44px; font-size: 15px; color: var(--ink);
}
.rows { list-style: none; margin: 0; padding: 0; background: var(--surface); border-top: 1px solid #ECEEF2; }
.row {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; min-height: 76px; text-decoration: none; color: var(--ink);
  border-bottom: 1px solid #ECEEF2;
}
.row:hover { background: #F8F9FB; color: var(--ink); }
.tile {
  width: 44px; height: 44px; flex: none; border-radius: 12px; display: grid; place-items: center;
  font-size: 17px; font-weight: 700; font-family: 'Noto Sans JP', var(--font);
}
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.go { color: var(--muted); }
.empty { padding: 48px 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.empty-ico { width: 72px; height: 72px; border-radius: 36px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.empty-t { font-size: 18px; font-weight: 600; }
.center { text-align: center; }
.nomatch { padding: 32px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
</style>
