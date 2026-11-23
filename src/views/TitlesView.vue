<script setup>
// ⑧ Title dictionary — static data bundled with the app: works without keys and offline.
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { RANK_LABELS } from '../data/titles.js'
import { searchTitles, groupByRank, TITLE_COUNT } from '../lib/titleSearch.js'
import { hasKeys } from '../services/settings.js'

const props = defineProps({ q: { type: String, default: '' } })
const { t, locale } = useI18n()
const route = useRoute()
const query = ref(props.q)
watch(() => props.q, v => { query.value = v })

// not set up yet -> no bottom nav: offer a way back to the welcome screen
const keyed = computed(() => { void route.fullPath; return hasKeys() })
const hits = computed(() => searchTitles(query.value))
const groups = computed(() => groupByRank(hits.value))
const rankLabel = r => RANK_LABELS[r]?.[locale.value] || RANK_LABELS[r]?.en || ''
</script>

<template>
  <div class="page titles">
    <header class="head">
      <RouterLink v-if="!keyed" to="/welcome" class="back"><Icon name="back" :size="20" />{{ t('common.back') }}</RouterLink>
      <div class="ttl">
        <h1 class="h1">{{ t('titles.title') }}</h1>
        <span class="sub">{{ t('titles.count', TITLE_COUNT) }}</span>
      </div>
      <label class="search">
        <span class="visually-hidden">{{ t('titles.searchLabel') }}</span>
        <Icon name="search" :size="20" class="s-ico" />
        <input v-model="query" type="search" class="s-inp" :placeholder="t('titles.search')" enterkeyhint="search" autocomplete="off">
      </label>
      <p v-if="query.trim()" class="matches" role="status">{{ t('titles.matches', hits.length) }}</p>
      <p class="notice">{{ t('titles.notice') }}</p>
    </header>

    <section v-for="g in groups" :key="g.rank" class="grp" :aria-labelledby="`rank-${g.rank}`">
      <div class="gh">
        <span class="lv" aria-hidden="true">{{ g.rank }}</span>
        <h2 :id="`rank-${g.rank}`" class="gl">{{ rankLabel(g.rank) }}</h2>
      </div>
      <ul class="rows">
        <li v-for="e in g.items" :key="e.ja" class="tr">
          <span class="col">
            <span class="jp" lang="ja">{{ e.ja }}</span>
            <span class="rd" lang="ja">{{ e.reading }}</span>
          </span>
          <span class="col">
            <span class="vn" lang="vi">{{ e.vi }}</span>
            <span class="en" lang="en">{{ e.en }}</span>
          </span>
        </li>
      </ul>
    </section>

    <div v-if="!groups.length" class="empty">
      <p class="hint center">{{ t('titles.empty') }}</p>
      <button type="button" class="btn" @click="query = ''">{{ t('titles.clear') }}</button>
    </div>
  </div>
</template>

<style scoped>
.titles { padding-top: 0; }
.head { padding: calc(20px + var(--safe-top)) 16px 4px; display: flex; flex-direction: column; gap: 12px; }
:global(.banner-on) .head { padding-top: 20px; }
.back { align-self: flex-start; min-height: 44px; margin: -12px 0 -4px -8px; padding: 0 8px; display: flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 500; text-decoration: none; }
.ttl { display: flex; flex-direction: column; gap: 2px; }
.h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.sub { font-size: 13px; color: var(--muted); }
.search { position: relative; display: block; }
.s-ico { position: absolute; left: 14px; top: 13px; color: var(--muted); pointer-events: none; }
.s-inp {
  width: 100%; height: 46px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface);
  padding: 0 14px 0 44px; font-size: 15px; color: var(--ink); font-family: var(--font);
}
.matches { font-size: 12px; color: var(--muted); margin-top: -4px; }
.notice { padding: 10px 12px; border-radius: 12px; background: var(--warn-bg); color: #5C3B00; font-size: 12.5px; line-height: 1.5; }
.gh { display: flex; align-items: center; gap: 10px; padding: 18px 16px 8px; }
.lv { width: 28px; height: 28px; flex: none; border-radius: 8px; background: var(--ink); color: #FFFFFF; font-size: 13px; font-weight: 700; display: grid; place-items: center; }
.gl { font-size: 14px; font-weight: 700; }
.rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid #ECEEF2; }
.tr { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 10px; padding: 10px 16px; border-bottom: 1px solid #ECEEF2; background: var(--surface); }
.col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.jp { font: 600 16px 'Noto Sans JP', sans-serif; color: var(--ink); overflow-wrap: anywhere; }
.rd { font: 400 11px 'Noto Sans JP', sans-serif; color: var(--muted); overflow-wrap: anywhere; }
.vn { font-size: 14px; font-weight: 600; color: var(--accent-ink); overflow-wrap: anywhere; }
.en { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.empty { padding: 32px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.center { text-align: center; }
</style>
