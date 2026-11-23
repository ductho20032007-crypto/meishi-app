<script setup>
// #/setup?c=<payload>: decode -> ping GitHub + Gemini -> save keys. Nothing is saved unless both checks pass.
import { ref, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { decodeSetup } from '../lib/setupLink.js'
import { createGitHub } from '../services/github.js'
import { createGemini } from '../services/gemini.js'
import { getConfig, saveKeys, hasKeys } from '../services/settings.js'
import { resetApp } from '../services/app.js'
import { db } from '../services/db.js'
import { errorKey } from '../i18n/errors.js'
import { resetStatus, syncNow, waitIdle } from '../stores/status.js'

const props = defineProps({ c: { type: String, default: '' } })
const { t } = useI18n()
const logo = import.meta.env.BASE_URL + 'logo.svg'
const router = useRouter()

const phase = ref('idle')   // idle | checking | invalid | failed
const checks = reactive({ github: { state: 'pending', kind: null }, gemini: { state: 'pending', kind: null } })
let cfg = null
let gen = 0                 // a newer setup link supersedes a run still in flight

// The payload holds real keys. Synchronously rewrite the current history entry (URL + vue-router state),
// then let the router replace its own location, so the payload survives nowhere (address bar, history.state,
// router.currentRoute). The decoded keys stay in memory only.
function scrub() {
  try {
    const st = history.state || {}
    history.replaceState({ ...st, current: '/setup', back: st.back ?? null, forward: null }, '', location.pathname + location.search + '#/setup')
  } catch { /* ignore */ }
  return router.replace({ path: '/setup' }).catch(() => {})
}

async function check(name, fn) {
  checks[name] = { state: 'pending', kind: null }
  try { await fn(); checks[name] = { state: 'ok', kind: null }; return true }
  catch (e) { checks[name] = { state: 'fail', kind: e?.kind || 'other' }; return false }
}

async function run() {
  const my = ++gen
  const next = cfg
  phase.value = 'checking'
  const [okGh, okGk] = await Promise.all([
    check('github', () => createGitHub({ token: next.gh, repo: next.repo }).ping()),
    check('gemini', () => createGemini({ key: next.gk }).ping())
  ])
  if (my !== gen) return
  if (!okGh || !okGk) { phase.value = 'failed'; return }
  // let a background sync of the old keys finish before swapping keys / clearing tables
  await waitIdle()
  if (my !== gen) return
  const prev = getConfig().repo
  resetApp()
  if (prev && prev !== next.repo) {
    // a different data repo than before: local data belongs to the old one, start clean
    await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(tb => tb.clear()))).catch(() => {})
  }
  saveKeys(next)
  cfg = null
  resetStatus()                 // binds status.ocr to the new repo
  await router.replace('/')
  syncNow({ force: true })      // a NEW run with the new keys, even if an old one was still finishing
}

function start(c) {
  scrub()
  try { cfg = decodeSetup(c) } catch { cfg = null; gen++; phase.value = 'invalid'; return }
  run()
}

// watch (not onMounted): opening a second setup link while already on #/setup reuses this component.
// An empty c is either our own scrub (ignored) or a bare #/setup visit (nothing to do here: leave).
watch(() => props.c, c => {
  if (c) start(c)
  else if (phase.value === 'idle') router.replace(hasKeys() ? '/' : '/welcome')
}, { immediate: true })
const errText = kind => t(errorKey(kind))
</script>

<template>
  <div class="page setup">
    <img class="logo" :src="logo" alt="" width="56" height="56" />
    <h1 class="page-title">{{ t('setup.title') }}</h1>

    <div v-if="phase === 'invalid'" class="card err" role="alert">
      <p class="row"><Icon name="alert" :size="20" /><span>{{ t('setup.invalid') }}</span></p>
    </div>

    <template v-else-if="phase !== 'idle'">
      <p v-if="phase === 'checking'" class="lead" role="status">{{ t('setup.checking') }}</p>
      <p v-else class="lead fail" role="alert">{{ t('setup.failed') }}</p>
      <ul class="card checks">
        <li v-for="name in ['github', 'gemini']" :key="name" class="check" :class="checks[name].state">
          <span class="mark" aria-hidden="true">
            <span v-if="checks[name].state === 'pending'" class="spin" />
            <Icon v-else :name="checks[name].state === 'ok' ? 'check' : 'close'" :size="16" />
          </span>
          <span class="what">
            <span class="name">{{ t(name === 'github' ? 'setup.checkingGithub' : 'setup.checkingGemini') }}</span>
            <span v-if="checks[name].state === 'fail'" class="why">{{ errText(checks[name].kind) }}</span>
          </span>
        </li>
      </ul>
      <div v-if="phase === 'failed'" class="actions">
        <button type="button" class="btn primary" @click="run">{{ t('common.retry') }}</button>
      </div>
    </template>

    <div v-if="phase === 'invalid' || phase === 'failed'" class="actions">
      <RouterLink to="/welcome" replace class="btn">{{ t('setup.back') }}</RouterLink>
    </div>
    <p class="hint warn">{{ t('setup.warn') }}</p>
  </div>
</template>

<style scoped>
.setup { display: flex; flex-direction: column; gap: 14px; padding-top: calc(48px + var(--safe-top)); }
.logo { margin: 0 16px; border-radius: 14px; }
.lead { padding: 0 16px; font-size: 15px; color: var(--ink-2); }
.lead.fail { color: var(--danger); font-weight: 600; }
.err { border-color: var(--danger-line); background: var(--danger-bg); color: var(--danger); }
.row { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.5; font-weight: 500; }
.checks { list-style: none; gap: 0; padding: 4px 14px; }
.check { display: flex; align-items: center; gap: 12px; min-height: 52px; }
.check + .check { border-top: 1px solid var(--line); }
.mark { width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center; background: var(--seg-bg); color: var(--muted); flex: none; }
.check.ok .mark { background: var(--ok); color: #fff; }
.check.fail .mark { background: var(--danger); color: #fff; }
.what { display: flex; flex-direction: column; min-width: 0; }
.name { font-size: 15px; font-weight: 600; }
.why { font-size: 13px; color: var(--danger); }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.actions { display: flex; flex-direction: column; gap: 8px; padding: 0 16px; }
.actions .btn { width: 100%; }
.warn { padding: 0 16px; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
