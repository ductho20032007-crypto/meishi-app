<script setup>
// ① Card list — search, filter chips, sort, month groups, pull-to-refresh, capture FAB.
import { computed, reactive, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import CardThumb from '../components/CardThumb.vue'
import { db } from '../services/db.js'
import { useLive } from '../composables/useLive.js'
import { status, syncNow } from '../stores/status.js'
import { errorKey } from '../i18n/errors.js'
import { cardTags, filterCards, sortCards, groupByMonth } from '../lib/listing.js'

const { t, locale } = useI18n()
const cards = useLive(() => db.cards.toArray(), null)
const companies = useLive(() => db.companies.toArray(), [])

// filter state survives navigating to a card and back (module scope, per session)
const ui = listUi
const companyMap = computed(() => new Map((companies.value || []).map(c => [c.id, c.name])))
const companyName = c => companyMap.value.get(c.companyId) || ''

const all = computed(() => cards.value || [])
const tags = computed(() => cardTags(all.value))
const pendingCount = computed(() => all.value.filter(c => c.status === 'pending').length)
const companyCount = computed(() => new Set(all.value.map(c => c.companyId).filter(Boolean)).size)
watch(tags, list => { if (ui.chip.startsWith('tag:') && !list.includes(ui.chip.slice(4))) ui.chip = 'all' })
watch(pendingCount, n => { if (!n && ui.chip === 'pending') ui.chip = 'all' })

const shown = computed(() => sortCards(filterCards(all.value, { q: ui.q, chip: ui.chip, companyName }), ui.sort, companyName))
const monthFmt = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }))
const monthLabel = key => {
  if (!key) return '—'
  const [y, m] = key.split('-').map(Number)
  return monthFmt.value.format(new Date(y, m - 1, 1))
}
// newest: month groups; name / company: one block whose header shows the count
const groups = computed(() => ui.sort === 'newest'
  ? groupByMonth(shown.value).map(g => ({ key: g.key, label: monthLabel(g.key), items: g.items }))
  : [{ key: 'all', label: t('list.cards', shown.value.length), items: shown.value }])

const filtered = computed(() => !!ui.q.trim() || ui.chip !== 'all')
const clearFilters = () => { ui.q = ''; ui.chip = 'all' }

// ---- row text ----
const lineDept = c => [(c.deptPath || []).join(' '), c.title].filter(Boolean).join(' · ')
const isReading = c => status.ocr?.runningId === c.id
const pendingLine = c => c.ocrError ? t(errorKey(c.ocrError)) : t('list.waiting')

// ---- sync button ----
const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }))
const dayFmt = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric' }))
const syncChip = computed(() => {
  if (status.syncing) return { icon: 'sync', tone: 'busy', text: t('list.syncing') }
  if (!status.online) return { icon: 'wifiOff', tone: 'muted', text: t('list.offline') }
  if (status.error) return { icon: 'alert', tone: 'bad', text: t('list.syncError') }
  if (status.outboxCount) return { icon: 'sync', tone: 'muted', text: t('list.queued', status.outboxCount) }
  if (!status.lastSyncAt) return { icon: 'sync', tone: 'muted', text: t('list.neverSynced') }
  const d = new Date(status.lastSyncAt)
  const today = d.toDateString() === new Date().toDateString()
  return { icon: 'sync', tone: 'ok', text: t('list.synced', { time: (today ? timeFmt : dayFmt).value.format(d) }) }
})

// ---- pull to refresh (touch drag > 70px while scrolled to the top) ----
const PULL = 70
const pull = reactive({ startY: null, dy: 0 })
function onTouchStart(e) {
  pull.startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null
  pull.dy = 0
}
function onTouchMove(e) {
  if (pull.startY == null) return
  pull.dy = Math.max(0, e.touches[0].clientY - pull.startY)
  if (window.scrollY > 0) { pull.startY = null; pull.dy = 0 }
}
function onTouchEnd() {
  if (pull.startY != null && pull.dy > PULL) syncNow()
  pull.startY = null; pull.dy = 0
}
const pullStyle = computed(() => ({ height: `${Math.min(pull.dy, PULL * 1.4) * 0.6}px` }))
onBeforeUnmount(() => { pull.startY = null })
</script>

<script>
import { reactive as r } from 'vue'
const listUi = r({ q: '', chip: 'all', sort: 'newest' })
</script>

<template>
  <div class="page list" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd">
    <div class="pull" :style="pullStyle" aria-hidden="true">
      <span v-if="pull.dy > 8" class="pull-txt"><Icon name="sync" :size="16" :class="{ ready: pull.dy > PULL }" />{{ pull.dy > PULL ? t('list.release') : t('list.pull') }}</span>
    </div>

    <header class="head">
      <div class="top">
        <div class="ttl">
          <h1 class="h1">{{ t('list.title') }}</h1>
          <span v-if="cards" class="sub">{{ t('list.cards', all.length) }} · {{ t('list.companies', companyCount) }}</span>
        </div>
        <button type="button" class="sync hit" :class="syncChip.tone" :aria-label="`${t('list.syncNow')} — ${syncChip.text}`" :disabled="status.syncing" @click="syncNow()">
          <Icon :name="syncChip.icon" :size="16" class="sync-ico" :class="{ spinning: status.syncing }" />
          <span>{{ syncChip.text }}</span>
        </button>
      </div>

      <label class="search">
        <span class="visually-hidden">{{ t('list.searchLabel') }}</span>
        <Icon name="search" :size="20" class="s-ico" />
        <input v-model="ui.q" type="search" class="s-inp" :placeholder="t('list.search')" enterkeyhint="search" autocomplete="off">
      </label>

      <div v-if="all.length" class="chips" role="group" :aria-label="t('list.filters')">
        <button type="button" class="chip hit" :class="{ on: ui.chip === 'all' }" :aria-pressed="ui.chip === 'all'" @click="ui.chip = 'all'">
          {{ t('list.all') }} <span class="n">{{ all.length }}</span>
        </button>
        <button v-if="pendingCount" type="button" class="chip warn hit" :class="{ on: ui.chip === 'pending' }" :aria-pressed="ui.chip === 'pending'" @click="ui.chip = ui.chip === 'pending' ? 'all' : 'pending'">
          <Icon name="clock" :size="15" />{{ t('list.pending') }} <span class="n">{{ pendingCount }}</span>
        </button>
        <button v-for="tag in tags" :key="tag" type="button" class="chip hit" :class="{ on: ui.chip === 'tag:' + tag }" :aria-pressed="ui.chip === 'tag:' + tag"
          @click="ui.chip = ui.chip === 'tag:' + tag ? 'all' : 'tag:' + tag">#{{ tag }}</button>
      </div>
    </header>

    <template v-if="cards">
      <div v-if="!all.length" class="empty">
        <span class="empty-ico" aria-hidden="true"><Icon name="cards" :size="34" /></span>
        <h2 class="empty-t">{{ t('list.emptyTitle') }}</h2>
        <p class="hint center">{{ t('list.emptyBody') }}</p>
        <RouterLink to="/capture" class="btn accent"><Icon name="camera" :size="18" />{{ t('list.emptyAction') }}</RouterLink>
      </div>

      <template v-else>
        <div v-for="(g, i) in groups" :key="g.key" class="group">
          <div class="bar">
            <span class="glabel">{{ g.label }}</span>
            <label v-if="i === 0" class="sort">
              <span class="visually-hidden">{{ t('list.sortLabel') }}</span>
              <select v-model="ui.sort">
                <option value="newest">{{ t('list.sort.newest') }}</option>
                <option value="name">{{ t('list.sort.name') }}</option>
                <option value="company">{{ t('list.sort.company') }}</option>
              </select>
              <Icon name="chevronDown" :size="14" />
            </label>
          </div>
          <ul class="rows">
            <li v-for="c in g.items" :key="c.id">
              <RouterLink :to="`/card/${c.id}`" class="row">
                <CardThumb :src="c.thumb" :pending="c.status === 'pending'" />
                <span class="txt">
                  <span class="l1">
                    <span class="name" :class="{ none: !c.name }">{{ c.name || t('list.unnamed') }}</span>
                    <span v-if="c.status === 'pending'" class="badge" :class="{ err: c.ocrError && !isReading(c) }">
                      {{ isReading(c) ? t('list.reading') : t('list.pending') }}
                    </span>
                  </span>
                  <span class="l2">{{ companyName(c) || c.companyRaw || (c.status === 'pending' ? pendingLine(c) : '') }}</span>
                  <span v-if="lineDept(c) || c.metPlace" class="l3">{{ lineDept(c) || c.metPlace }}</span>
                </span>
                <Icon name="chevron" :size="18" class="chev" />
              </RouterLink>
            </li>
          </ul>
        </div>
        <div v-if="!shown.length" class="nomatch">
          <p class="hint center">{{ t('list.noMatch') }}</p>
          <button v-if="filtered" type="button" class="btn" @click="clearFilters">{{ t('list.clear') }}</button>
        </div>
      </template>
    </template>

    <RouterLink to="/capture" class="fab" :aria-label="t('list.capture')"><Icon name="camera" :size="26" /></RouterLink>
  </div>
</template>

<style scoped>
.list { padding-top: 0; padding-bottom: 96px; }
.pull { display: flex; align-items: flex-end; justify-content: center; overflow: hidden; transition: height 0.15s ease; }
.pull-txt { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; font-size: 12px; color: var(--muted); }
.pull-txt .ready { color: var(--accent); }
.head { padding: calc(20px + var(--safe-top)) 16px 12px; display: flex; flex-direction: column; gap: 14px; }
:global(.banner-on) .head { padding-top: 20px; }
.top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.ttl { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.sub { font-size: 13px; color: var(--muted); }
.sync {
  flex: none; max-width: 55%; height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--line-2); background: var(--surface);
  color: var(--ink-2); font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px;
}
.sync span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync:disabled { opacity: 1; }
.sync.ok .sync-ico { color: var(--ok); }
.sync.bad { color: var(--danger); border-color: var(--danger-line); }
.sync.busy .sync-ico { color: var(--accent); }
.search { position: relative; display: block; }
.s-ico { position: absolute; left: 14px; top: 13px; color: var(--muted); pointer-events: none; }
.s-inp {
  width: 100%; height: 46px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface);
  padding: 0 14px 0 44px; font-size: 15px; color: var(--ink);
}
.chips { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip {
  flex: none; height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--line-2); background: var(--surface);
  color: var(--ink-2); font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; white-space: nowrap;
}
.chip .n { opacity: 0.7; }
.chip.on { background: var(--ink); border-color: var(--ink); color: #FFFFFF; }
.chip.warn { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn-ink); }
.chip.warn.on { background: var(--warn-ink); border-color: var(--warn-ink); color: #FFFFFF; }
.bar { display: flex; justify-content: space-between; align-items: center; padding: 4px 16px 8px; min-height: 40px; font-size: 12px; color: var(--muted); }
.glabel { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.group + .group .bar { padding-top: 16px; }
.sort { position: relative; display: flex; align-items: center; gap: 4px; color: var(--ink-2); font-weight: 500; }
.sort select {
  appearance: none; -webkit-appearance: none; border: 0; background: none; font-size: 12px; font-weight: 500; color: var(--ink-2);
  min-height: 44px; padding: 0 18px 0 8px; margin: -6px -18px -6px 0; position: relative; z-index: 1;
}
.rows { list-style: none; margin: 0; padding: 0; background: var(--surface); border-top: 1px solid #ECEEF2; }
.row {
  display: flex; align-items: center; gap: 14px; padding: 12px 16px; min-height: 72px; text-decoration: none; color: var(--ink);
  border-bottom: 1px solid #ECEEF2;
}
.row:hover { background: #F8F9FB; color: var(--ink); }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.l1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name.none { color: var(--muted); font-weight: 500; }
.badge { flex: none; font-size: 11px; font-weight: 600; color: var(--warn-ink); background: var(--warn-bg); border-radius: 10px; padding: 2px 8px; }
.badge.err { color: var(--danger); background: var(--danger-bg); }
.l2 { font-size: 13px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.l3 { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chev { color: var(--faint); }
.empty { padding: 48px 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.empty-ico { width: 72px; height: 72px; border-radius: 36px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.empty-t { font-size: 18px; font-weight: 600; }
.empty .btn { margin-top: 8px; }
.center { text-align: center; }
.nomatch { padding: 32px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.fab {
  position: fixed; right: calc(18px + var(--safe-right)); bottom: calc(var(--nav-h) + var(--safe-bottom) + 20px); z-index: 15;
  width: 60px; height: 60px; border-radius: 30px; background: var(--accent); color: #FFFFFF;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(47, 91, 211, 0.35);
}
.fab:hover { color: #FFFFFF; background: var(--accent-ink); }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } .pull { transition: none; } }
</style>
