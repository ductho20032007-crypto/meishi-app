<script setup>
// ⑦ Settings — no key inputs (keys only arrive through the setup link, spec §3.5).
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import LangSegment from '../components/LangSegment.vue'
import { errorKey } from '../i18n/errors.js'
import { getConfig, setPref, clearKeys } from '../services/settings.js'
import { getApp, resetApp } from '../services/app.js'
import { DEFAULT_MODELS } from '../services/gemini.js'
import { db } from '../services/db.js'
import { toCsv } from '../lib/csv.js'
import { toVCards } from '../lib/vcard.js'
import { status, syncNow, resetStatus } from '../stores/status.js'

const { t, locale } = useI18n()
const cfg = getConfig()
const repoName = cfg.repo || '—'

// ---- connection checks ----
const conn = reactive({ github: { state: 'unknown', kind: null }, gemini: { state: 'unknown', kind: null } })
async function test(name) {
  conn[name] = { state: 'checking', kind: null }
  try {
    const app = getApp()
    await (name === 'github' ? app.gh : app.gemini).ping()
    conn[name] = { state: 'ok', kind: null }
    if (name === 'gemini' && app.repo.ocrState.get().error) { app.repo.clearOcrError(); syncNow() }
    if (name === 'github' && status.error) syncNow({ ocr: false })
  } catch (e) {
    conn[name] = { state: 'fail', kind: e?.kind || 'other' }
  }
}
const errText = kind => t(errorKey(kind))
const stateText = s => t(s === 'ok' ? 'settings.connected' : s === 'fail' ? 'settings.notConnected' : s === 'checking' ? 'settings.checking' : 'settings.unknown')
// While background sync fails for auth / missing repo, the card shows that failure even if a ping succeeded.
const ghShown = computed(() => (status.error === 'auth' || status.error === 'repomissing')
  ? { state: 'fail', kind: status.error, pingOk: conn.github.state === 'ok' } : conn.github)
const gkShown = computed(() => status.ocr?.error ? { state: 'fail', kind: status.ocr.error } : conn.gemini)
const stateLine = x => x.pingOk ? t('settings.syncFailed', { reason: errText(x.kind) })
  : x.state === 'fail' ? `${stateText('fail')} · ${errText(x.kind)}` : stateText(x.state)

// ---- model ----
const model = ref(cfg.model || '')
const models = computed(() => [...DEFAULT_MODELS, ...(model.value && !DEFAULT_MODELS.includes(model.value) ? [model.value] : [])])
function changeModel() {
  setPref('model', model.value || null)
  resetApp()      // the Gemini client is rebuilt with the new model
  resetStatus()
  syncNow({ force: true })
}

// ---- sync ----
const lastText = computed(() => {
  if (!status.lastSyncAt) return t('settings.never')
  try { return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(status.lastSyncAt)) }
  catch { return status.lastSyncAt }
})
const syncErr = computed(() => status.error ? errText(status.error) : '')

// ---- export ----
const exportMsg = ref('')
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportAll(kind) {
  exportMsg.value = ''
  const [cards, companies] = await Promise.all([db.cards.toArray(), db.companies.toArray()])
  if (!cards.length) { exportMsg.value = t('settings.exportEmpty'); return }
  const names = new Map(companies.map(c => [c.id, c.name]))
  const nameOf = c => names.get(c.companyId) || c.companyRaw || ''
  cards.sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  if (kind === 'csv') download(`meishi-${stamp}.csv`, toCsv(cards, nameOf), 'text/csv;charset=utf-8')
  else download(`meishi-${stamp}.vcf`, toVCards(cards, nameOf), 'text/vcard;charset=utf-8')
}

// ---- remove keys ----
const removing = ref(false)
async function removeKeys() {
  const n = status.outboxCount
  if (!window.confirm(n ? t('settings.removeConfirm', n) : t('settings.removeConfirmClean'))) return
  removing.value = true
  resetApp()          // disposes the repo (aborts OCR)
  resetStatus()
  clearKeys()
  try { db.close(); await db.delete() } catch (e) { console.warn('db.delete', e) }
  // reload for a clean in-memory state (fresh Dexie instance, no live queries on the deleted DB)
  history.replaceState(null, '', location.pathname + location.search + '#/welcome')
  location.reload()
}

onMounted(() => { test('github'); test('gemini') })
</script>

<template>
  <div class="page settings">
    <h1 class="page-title">{{ t('settings.title') }}</h1>

    <h2 class="sec">{{ t('settings.lang') }}</h2>
    <div class="card">
      <LangSegment />
      <span class="hint">{{ t('settings.langHint') }}</span>
    </div>

    <h2 class="sec">{{ t('settings.github') }}</h2>
    <div class="card">
      <div class="kv"><span>{{ t('settings.repo') }}</span><span class="mono">{{ repoName }}</span></div>
      <div class="status-row">
        <span class="state" :class="ghShown.state" role="status">
          <span class="dot" aria-hidden="true"><Icon v-if="ghShown.state === 'ok'" name="check" :size="12" /><Icon v-else-if="ghShown.state === 'fail'" name="close" :size="12" /></span>
          <span>{{ stateLine(ghShown) }}</span>
        </span>
        <button type="button" class="btn" :disabled="conn.github.state === 'checking'" @click="test('github')">{{ t('settings.test') }}</button>
      </div>
    </div>

    <h2 class="sec">{{ t('settings.gemini') }}</h2>
    <div class="card">
      <div class="status-row">
        <span class="state" :class="gkShown.state" role="status">
          <span class="dot" aria-hidden="true"><Icon v-if="gkShown.state === 'ok'" name="check" :size="12" /><Icon v-else-if="gkShown.state === 'fail'" name="close" :size="12" /></span>
          <span>{{ stateLine(gkShown) }}</span>
        </span>
        <button type="button" class="btn" :disabled="conn.gemini.state === 'checking'" @click="test('gemini')">{{ t('settings.test') }}</button>
      </div>
      <label class="field">
        <span class="lbl">{{ t('settings.model') }}</span>
        <span class="select">
          <select v-model="model" class="inp" @change="changeModel">
            <option value="">{{ t('settings.modelAuto') }}</option>
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </select>
          <Icon name="chevronDown" :size="18" class="caret" />
        </span>
      </label>
      <span class="hint">{{ t('settings.privacy') }}</span>
    </div>

    <h2 class="sec">{{ t('settings.sync') }}</h2>
    <div class="card">
      <div class="kv"><span>{{ t('settings.last') }}</span><span>{{ lastText }}</span></div>
      <div class="kv"><span>{{ t('settings.queue') }}</span><span>{{ status.outboxCount }}</span></div>
      <div v-if="status.conflictCount" class="kv warn"><span>{{ t('settings.conflicts') }}</span><span>{{ status.conflictCount }}</span></div>
      <div v-if="status.pendingCount" class="kv"><span>{{ t('settings.ocr') }}</span><span>{{ status.pendingCount }}</span></div>
      <p v-if="syncErr" class="err-line" role="alert"><Icon name="alert" :size="16" />{{ syncErr }}</p>
      <div class="btns">
        <button type="button" class="btn primary grow2" :disabled="status.syncing" @click="syncNow()">
          <Icon name="sync" :size="16" :class="{ spinning: status.syncing }" />{{ status.syncing ? t('settings.syncing') : t('settings.syncNow') }}
        </button>
        <button type="button" class="btn grow" @click="exportAll('csv')"><Icon name="download" :size="16" />{{ t('settings.exportCsv') }}</button>
        <button type="button" class="btn grow" @click="exportAll('vcard')"><Icon name="download" :size="16" />{{ t('settings.exportVcard') }}</button>
      </div>
      <span class="hint" role="status">{{ exportMsg || t('settings.exportHint') }}</span>
    </div>

    <h2 class="sec">{{ t('settings.titlesLink') }}</h2>
    <RouterLink to="/titles" class="card link">
      <span class="tile" aria-hidden="true"><Icon name="book" :size="20" /></span>
      <span class="txt"><span class="ttl">{{ t('settings.titlesLink') }}</span><span class="hint">{{ t('settings.titlesHint') }}</span></span>
      <Icon name="chevron" :size="18" class="chev" />
    </RouterLink>

    <h2 class="sec">{{ t('settings.device') }}</h2>
    <div class="card">
      <button type="button" class="btn danger" :disabled="removing" @click="removeKeys"><Icon name="trash" :size="16" />{{ t('settings.removeKeys') }}</button>
      <span class="hint">{{ t('settings.removeHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.settings { padding-bottom: 32px; }
.kv { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; min-height: 28px; }
.kv span:first-child { color: var(--muted); flex: none; }
.kv span:last-child { min-width: 0; overflow-wrap: anywhere; text-align: right; }
.kv.warn span { color: var(--warn-ink); font-weight: 600; }
.mono { font-weight: 600; }
.status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.state { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--muted); }
.state.ok { color: var(--ok-ink); }
.state.fail { color: var(--danger); }
.dot { width: 18px; height: 18px; border-radius: 9px; background: var(--line-2); color: #fff; display: grid; place-items: center; flex: none; }
.state.ok .dot { background: var(--ok); }
.state.fail .dot { background: var(--danger); }
.state.checking .dot { background: var(--accent-soft); }
.status-row .btn { flex: none; }
.field { display: flex; flex-direction: column; gap: 6px; }
.select { position: relative; display: block; }
.select select { appearance: none; -webkit-appearance: none; padding-right: 40px; }
.caret { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.btns { display: flex; gap: 8px; }
.btns .btn { padding: 0 10px; }
.grow { flex: 1; }
.grow2 { flex: 1.6; }
.err-line { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--danger); }
.link { flex-direction: row; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); min-height: 64px; }
.tile { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; flex: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ttl { font-size: 15px; font-weight: 600; }
.chev { color: var(--faint); }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
