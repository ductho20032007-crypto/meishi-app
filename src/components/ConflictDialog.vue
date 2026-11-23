<script setup>
// Sync conflicts (db.conflicts): per record, the fields both devices changed, local vs cloud; keep one side.
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import { db } from '../services/db.js'
import { getApp } from '../services/app.js'
import { useLive } from '../composables/useLive.js'
import { errorKey } from '../i18n/errors.js'
import { conflictFields, formatValue, fieldKey } from '../lib/conflicts.js'
import { RANK_LABELS } from '../data/titles.js'

const emit = defineEmits(['close'])
const { t, te, locale } = useI18n()
const rows = useLive(() => db.conflicts.toArray(), null)
const companies = useLive(() => db.companies.toArray(), [])
const cards = useLive(() => db.cards.toArray(), [])
const companyName = id => (companies.value || []).find(c => c.id === id)?.name || id
// reportsTo points at a card or a placeholder of the same company
const personName = id => (cards.value || []).find(c => c.id === id)?.name
  || (companies.value || []).flatMap(c => c.placeholders || []).find(p => p.id === id)?.name || id

const dlg = ref(null)
onMounted(() => { try { dlg.value?.showModal() } catch { dlg.value?.setAttribute('open', '') } })
// the native close event is the single place that emits (Esc, close button, programmatic close)
let closed = false
const onClosed = () => { if (!closed) { closed = true; emit('close') } }
const close = () => { if (dlg.value?.open && typeof dlg.value.close === 'function') dlg.value.close(); else onClosed() }

const label = (f, isCompany) => { const k = fieldKey(f, isCompany); return te(k) ? t(k) : f }
const fmt = (f, v) => formatValue(f, v, {
  empty: t('common.empty'),
  image: t('conflict.image'),
  phoneType: ty => t(`field.phoneType.${['mobile', 'office', 'fax'].includes(ty) ? ty : 'office'}`),
  rankLabel: n => `${n} · ${RANK_LABELS[n]?.[locale.value] || RANK_LABELS[n]?.en || ''}`,
  companyName,
  personName
})
const items = computed(() => (rows.value || []).map(c => {
  const rec = c.local || c.remote || {}
  return {
    path: c.path,
    isCompany: c.path.startsWith('companies/'),
    kind: c.path.startsWith('companies/') ? t('conflict.company') : t('conflict.card'),
    name: rec.name || t('detail.noName'),
    ...conflictFields(c)
  }
}))

const busy = reactive({})
const error = ref('')
const resolved = ref(false)
async function resolve(path, keep) {
  busy[path] = keep; error.value = ''
  try { await getApp().sync.resolve(path, keep) }
  catch (e) { error.value = t('conflict.failed', { reason: t(errorKey(e?.kind)) }) }
  finally { delete busy[path] }
}
watch(rows, (now, before) => { if (before?.length && !now?.length) resolved.value = true })
</script>

<template>
  <dialog ref="dlg" class="sheet" aria-labelledby="cf-title" @close="onClosed">
    <header class="hd">
      <h2 id="cf-title" class="ttl">{{ t('conflict.title') }}</h2>
      <button type="button" class="x" :aria-label="t('common.close')" @click="close"><Icon name="close" /></button>
    </header>
    <div class="body">
      <p v-if="resolved && !items.length" class="done" role="status"><Icon name="check" :size="18" />{{ t('conflict.allDone') }}</p>
      <p v-else class="hint">{{ t('conflict.intro') }}</p>
      <p v-if="error" class="err" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>

      <section v-for="it in items" :key="it.path" class="item">
        <div class="it-head"><span class="kind">{{ it.kind }}</span><strong class="nm">{{ it.name }}</strong></div>
        <p v-if="it.deleted === 'remote'" class="note">{{ t('conflict.deletedRemote') }}</p>
        <p v-else-if="it.deleted === 'local'" class="note">{{ t('conflict.deletedLocal') }}</p>
        <dl v-else class="fields">
          <div v-for="f in it.fields" :key="f" class="fld">
            <dt>{{ label(f, it.isCompany) }}</dt>
            <dd>
              <span class="side"><span class="who">{{ t('conflict.thisDevice') }}</span><span class="val">{{ fmt(f, it.local?.[f]) }}</span></span>
              <span class="side"><span class="who">{{ t('conflict.cloudSide') }}</span><span class="val">{{ fmt(f, it.remote?.[f]) }}</span></span>
            </dd>
          </div>
        </dl>
        <div class="btns">
          <button type="button" class="btn grow" :disabled="!!busy[it.path]" @click="resolve(it.path, 'local')">
            {{ t('conflict.mine') + (it.deleted === 'local' ? ` (${t('conflict.deleted')})` : '') }}
          </button>
          <button type="button" class="btn primary grow" :disabled="!!busy[it.path]" @click="resolve(it.path, 'remote')">
            {{ t('conflict.cloud') + (it.deleted === 'remote' ? ` (${t('conflict.deleted')})` : '') }}
          </button>
        </div>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: 100%; max-width: 560px; max-height: 88dvh; margin: auto auto 0; padding: 0; border: 0; border-radius: 18px 18px 0 0;
  background: var(--bg); color: var(--ink); display: flex; flex-direction: column;
}
.sheet:not([open]) { display: none; }
.sheet::backdrop { background: rgba(10, 12, 16, 0.5); }
.hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.ttl { font-size: 17px; font-weight: 600; }
.x { width: 44px; height: 44px; border: 0; background: none; display: grid; place-items: center; border-radius: 10px; color: var(--ink); }
.body { overflow: auto; padding: 14px 16px calc(20px + var(--safe-bottom)); display: flex; flex-direction: column; gap: 12px; }
.done { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--ok-ink); }
.err { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--danger); }
.item { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.it-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.kind { flex: none; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.nm { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 13px; color: var(--warn-ink); background: var(--warn-bg); border-radius: 10px; padding: 8px 10px; line-height: 1.45; }
.fields { margin: 0; display: flex; flex-direction: column; gap: 10px; }
.fld dt { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 4px; }
.fld dd { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.side { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); min-width: 0; }
.side:last-child { border-color: #8FA8EA; background: #F7F9FE; }
.who { font-size: 11px; color: var(--muted); }
.val { font-size: 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.btns { display: flex; gap: 8px; }
.grow { flex: 1; padding: 0 10px; text-align: center; }
</style>
