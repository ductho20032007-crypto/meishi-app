<script setup>
// ④ Edit card — every field; values still equal to what Gemini read get an "AI" badge + accent border.
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { db } from '../services/db.js'
import { getApp } from '../services/app.js'
import { useLive } from '../composables/useLive.js'
import { rankFor, viFor } from '../lib/rank.js'
import { RANK_LABELS } from '../data/titles.js'
import { buildOrg } from '../lib/orgChart.js'
import { cardTags } from '../lib/listing.js'
import { aiFilled, aiItem, aiCompany, diffPatch } from '../lib/aiFields.js'

const props = defineProps({ id: { type: String, required: true } })
const { t, locale } = useI18n()
const router = useRouter()
const NEW = '__new'
const PHONE_TYPES = ['mobile', 'office', 'fax']

const original = ref(undefined)       // card as loaded (undefined = loading, null = not found)
const form = reactive({
  name: '', nameKana: '', nameLatin: '', companyId: '', deptPath: [], title: '', rank: null, reportsTo: null,
  phones: [], emails: [], address: '', website: '', metPlace: '', metAt: '', tags: [], memo: ''
})
const FIELDS = Object.keys(form)
const toForm = c => ({
  name: c.name || '', nameKana: c.nameKana || '', nameLatin: c.nameLatin || '', companyId: c.companyId || '',
  deptPath: [...(c.deptPath || [])], title: c.title || '', rank: c.rank ?? null, reportsTo: c.reportsTo ?? null,
  phones: (c.phones || []).map(p => ({ type: p.type || 'office', value: p.value || '' })), emails: [...(c.emails || [])],
  address: c.address || '', website: c.website || '', metPlace: c.metPlace || '', metAt: c.metAt || '', tags: [...(c.tags || [])], memo: c.memo || ''
})
const newCompanyName = ref('')
const rankTouched = ref(false)

const companies = useLive(() => db.companies.toArray(), [])
const cards = useLive(() => db.cards.toArray(), [])

let loaded = false
// title -> rank, unless the user picked the rank (sync flush: never fires for the initial fill below)
watch(() => form.title, v => { if (loaded && !rankTouched.value) form.rank = v.trim() ? rankFor(v) : null }, { flush: 'sync' })
onMounted(async () => {
  const c = await db.cards.get(props.id)
  original.value = c || null
  if (!c) return
  Object.assign(form, toForm(c))
  rankTouched.value = c.rank != null && c.rank !== rankFor(c.title || '')   // a manual rank stays put when the title changes
  loaded = true
})

// ---- company ----
const countBy = computed(() => {
  const m = new Map()
  for (const c of cards.value || []) if (c.companyId) m.set(c.companyId, (m.get(c.companyId) || 0) + 1)
  return m
})
const companyOptions = computed(() => [...(companies.value || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'))
  .map(c => ({ id: c.id, label: `${c.name} (${t('edit.cardsInCompany', countBy.value.get(c.id) || 0)})` })))
const selectedCompany = computed(() => (companies.value || []).find(c => c.id === form.companyId) || null)
watch(() => form.companyId, v => {
  if (v === NEW && !newCompanyName.value) newCompanyName.value = original.value?.companyRaw || ''
})

// ---- reports to (people + placeholders of the same company; first option = inferred boss) ----
const colleagues = computed(() => (cards.value || []).filter(c => form.companyId && c.companyId === form.companyId && c.id !== props.id))
const placeholders = computed(() => selectedCompany.value?.placeholders || [])
const personLabel = p => [p.name || t('detail.noName'), p.title ? `(${p.title})` : ''].filter(Boolean).join(' ')
const bossOptions = computed(() => [
  ...colleagues.value.map(c => ({ id: c.id, label: personLabel(c) })),
  ...placeholders.value.map(p => ({ id: p.id, label: t('edit.noCard', { name: personLabel(p) }) }))
])
const inferred = computed(() => {
  if (!original.value || !selectedCompany.value) return null
  const self = { id: props.id, name: form.name, title: form.title, rank: form.rank, deptPath: form.deptPath.filter(s => s.trim()), reportsTo: null }
  try { return buildOrg([...colleagues.value, ...placeholders.value, self], selectedCompany.value.deptAliases || {}).bossOf(props.id) }
  catch (e) { console.warn('buildOrg', e); return null }
})
watch(bossOptions, list => { if (form.reportsTo && !list.some(o => o.id === form.reportsTo)) form.reportsTo = null })

// ---- department levels ----
const segInputs = ref([])
async function addLevel() {
  form.deptPath.push('')
  await nextTick()
  segInputs.value[form.deptPath.length - 1]?.focus()
}
const removeLevel = i => form.deptPath.splice(i, 1)
// rough width: CJK ≈ 1em, other ≈ 0.6em
const segWidth = s => `calc(${[...(s || '')].reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 1 : 0.6), 0) + 1.2}em + 26px)`

// ---- title / rank ----
const vi = computed(() => (form.title.trim() ? viFor(form.title) : null))
const rankLabel = n => `${n} · ${RANK_LABELS[n]?.[locale.value] || RANK_LABELS[n]?.en || ''}`

// ---- tags ----
const tagChoices = computed(() => [...new Set([...cardTags(cards.value || []), ...form.tags])])
const toggleTag = tag => { form.tags = form.tags.includes(tag) ? form.tags.filter(x => x !== tag) : [...form.tags, tag] }
const addingTag = ref(false)
const newTag = ref('')
const tagInput = ref(null)
async function startTag() { addingTag.value = true; await nextTick(); tagInput.value?.focus() }
function commitTag() {
  const tag = newTag.value.replace(/^#+/, '').trim()
  if (tag && !form.tags.includes(tag)) form.tags = [...form.tags, tag]
  newTag.value = ''; addingTag.value = false
}

// ---- AI marks ----
const ai = f => !!original.value && aiFilled(original.value, f, f === 'deptPath' ? form.deptPath.filter(s => s.trim()) : form[f])
const aiPhone = p => !!original.value && aiItem(original.value, 'phones', { type: p.type, value: p.value.trim() })
const aiEmail = e => !!original.value && aiItem(original.value, 'emails', e.trim())
const aiCo = computed(() => !!original.value && aiCompany(original.value, selectedCompany.value))
const anyAi = computed(() => original.value?.ocrBy === 'gemini' && (aiCo.value || form.phones.some(aiPhone) || form.emails.some(aiEmail) ||
  ['name', 'nameKana', 'nameLatin', 'deptPath', 'title', 'rank', 'address', 'website'].some(ai)))

// ---- save / cancel ----
function cleaned() {
  const s = v => (typeof v === 'string' ? v.trim() : v)
  return {
    ...Object.fromEntries(FIELDS.map(f => [f, s(form[f])])),
    companyId: form.companyId && form.companyId !== NEW ? form.companyId : null,
    deptPath: form.deptPath.map(x => x.trim()).filter(Boolean),
    phones: form.phones.map(p => ({ type: p.type, value: p.value.trim() })).filter(p => p.value),
    emails: form.emails.map(x => x.trim()).filter(Boolean),
    tags: [...form.tags]
  }
}
const dirty = computed(() => !!original.value && (form.companyId === NEW || Object.keys(diffPatch(toForm(original.value), cleaned(), FIELDS)).length > 0))
const saving = ref(false)
const error = ref('')
async function save() {
  if (!original.value || saving.value) return
  if (addingTag.value) commitTag()
  error.value = ''
  if (form.companyId === NEW && !newCompanyName.value.trim()) { error.value = t('edit.newCompanyRequired'); return }
  saving.value = true
  try {
    const repo = getApp().repo
    const next = cleaned()
    if (form.companyId === NEW) next.companyId = await repo.createCompany(newCompanyName.value)
    // only changed fields: a concurrent OCR result / sync for untouched fields is kept
    const patch = diffPatch(toForm(original.value), next, FIELDS)
    if ('companyId' in patch && !('reportsTo' in patch)) patch.reportsTo = next.reportsTo
    if ('title' in patch) patch.rank = next.rank     // never let the repo override a rank chosen here
    if (Object.keys(patch).length) await repo.updateCard(props.id, patch)
    leave()
  } catch (e) {
    console.warn('save', e)
    error.value = t('edit.failed')
  } finally { saving.value = false }
}
function cancel() {
  if (dirty.value && !window.confirm(t('edit.discard'))) return
  leave()
}
function leave() {
  if (router.options.history.state?.back === `/card/${props.id}`) router.back()
  else router.replace(`/card/${props.id}`)
}
</script>

<template>
  <div class="editv">
    <header class="bar">
      <button type="button" class="hbtn" @click="cancel">{{ t('common.cancel') }}</button>
      <h1 class="h1">{{ t('edit.title') }}</h1>
      <button type="button" class="hbtn strong" :disabled="!original || saving" @click="save">{{ saving ? t('edit.saving') : t('common.save') }}</button>
    </header>

    <div v-if="original === null" class="missing">
      <p class="hint">{{ t('detail.notFound') }}</p>
      <RouterLink to="/" class="btn">{{ t('detail.toList') }}</RouterLink>
    </div>

    <template v-else-if="original">
      <p v-if="error" class="msg err" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
      <div v-if="anyAi" class="ainote">
        <span class="ai on-white">{{ t('edit.aiBadge') }}</span>
        <span>{{ t('edit.aiNote') }}</span>
      </div>

      <form class="form" @submit.prevent="save">
        <h2 class="sub">{{ t('edit.person') }}</h2>
        <label class="f"><span class="lbl">{{ t('field.name') }}<span v-if="ai('name')" class="ai" :title="t('edit.aiLabel')">{{ t('edit.aiBadge') }}</span></span>
          <input v-model="form.name" class="inp" :class="{ ocr: ai('name') }" autocomplete="off"></label>
        <div class="grid2">
          <label class="f"><span class="lbl">{{ t('field.nameKana') }}<span v-if="ai('nameKana')" class="ai">{{ t('edit.aiBadge') }}</span></span>
            <input v-model="form.nameKana" class="inp" :class="{ ocr: ai('nameKana') }" autocomplete="off"></label>
          <label class="f"><span class="lbl">{{ t('field.nameLatin') }}<span v-if="ai('nameLatin')" class="ai">{{ t('edit.aiBadge') }}</span></span>
            <input v-model="form.nameLatin" class="inp" :class="{ ocr: ai('nameLatin') }" autocomplete="off"></label>
        </div>

        <h2 class="sub">{{ t('edit.org') }}</h2>
        <label class="f"><span class="lbl">{{ t('field.company') }}<span v-if="aiCo" class="ai">{{ t('edit.aiBadge') }}</span></span>
          <span class="select">
            <select v-model="form.companyId" class="inp" :class="{ ocr: aiCo }">
              <option value="">{{ t('edit.noCompany') }}</option>
              <option v-for="o in companyOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
              <option :value="NEW">{{ t('edit.newCompany') }}</option>
            </select>
            <Icon name="chevronDown" :size="18" class="caret" />
          </span>
        </label>
        <label v-if="form.companyId === NEW" class="f"><span class="lbl">{{ t('edit.newCompanyName') }}</span>
          <input v-model="newCompanyName" class="inp" autocomplete="off"></label>

        <div class="f">
          <span class="lbl" id="dept-lbl">{{ t('edit.deptHint') }}<span v-if="ai('deptPath')" class="ai">{{ t('edit.aiBadge') }}</span></span>
          <div class="segs" role="group" aria-labelledby="dept-lbl">
            <template v-for="(s, i) in form.deptPath" :key="i">
              <Icon v-if="i > 0" name="chevron" :size="16" class="segsep" />
              <span class="seg" :class="{ ocr: ai('deptPath') }">
                <input :ref="el => { segInputs[i] = el }" v-model="form.deptPath[i]" :style="{ width: segWidth(s) }" :aria-label="t('edit.levelLabel', { n: i + 1 })" autocomplete="off">
                <button type="button" class="segx hit" :aria-label="t('edit.removeLevel', { name: s || i + 1 })" @click="removeLevel(i)"><Icon name="close" :size="14" /></button>
              </span>
            </template>
            <button type="button" class="dashed hit" @click="addLevel">{{ t('edit.addLevel') }}</button>
          </div>
        </div>

        <div class="grid2">
          <label class="f"><span class="lbl">{{ t('field.title') }}<span v-if="ai('title')" class="ai">{{ t('edit.aiBadge') }}</span></span>
            <input v-model="form.title" class="inp" :class="{ ocr: ai('title') }" autocomplete="off"></label>
          <label class="f"><span class="lbl">{{ t('field.rank') }}<span v-if="ai('rank')" class="ai">{{ t('edit.aiBadge') }}</span></span>
            <span class="select">
              <select v-model="form.rank" class="inp" :class="{ ocr: ai('rank') }" @change="rankTouched = true">
                <option :value="null">{{ t('edit.rankUnset') }}</option>
                <option v-for="n in 7" :key="n" :value="n">{{ rankLabel(n) }}</option>
              </select>
              <Icon name="chevronDown" :size="18" class="caret" />
            </span>
          </label>
        </div>
        <span v-if="vi" class="hint vi">{{ t('edit.viHint', { vi }) }}</span>

        <label class="f"><span class="lbl">{{ t('field.reportsTo') }}</span>
          <span class="select">
            <select v-model="form.reportsTo" class="inp" :disabled="!selectedCompany">
              <option :value="null">{{ inferred ? t('edit.auto', { name: personLabel(inferred) }) : t('edit.autoNone') }}</option>
              <option v-for="o in bossOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
            </select>
            <Icon name="chevronDown" :size="18" class="caret" />
          </span>
        </label>

        <h2 class="sub">{{ t('edit.contact') }}</h2>
        <div v-for="(p, i) in form.phones" :key="'p' + i" class="line">
          <span class="select type">
            <select v-model="p.type" class="inp" :aria-label="t('edit.phoneType')">
              <option v-for="ty in PHONE_TYPES" :key="ty" :value="ty">{{ t(`field.phoneType.${ty}`) }}</option>
            </select>
            <Icon name="chevronDown" :size="16" class="caret" />
          </span>
          <input v-model="p.value" class="inp" :class="{ ocr: aiPhone(p) }" type="tel" :aria-label="t(`field.phoneType.${p.type}`)" autocomplete="off">
          <button type="button" class="x hit" :aria-label="t('common.remove')" @click="form.phones.splice(i, 1)"><Icon name="close" :size="18" /></button>
        </div>
        <button type="button" class="add hit" @click="form.phones.push({ type: 'mobile', value: '' })">{{ t('edit.addPhone') }}</button>

        <div v-for="(e, i) in form.emails" :key="'e' + i" class="f">
          <span v-if="i === 0" class="lbl">{{ t('field.emails') }}<span v-if="form.emails.some(aiEmail)" class="ai">{{ t('edit.aiBadge') }}</span></span>
          <div class="line">
            <input v-model="form.emails[i]" class="inp" :class="{ ocr: aiEmail(e) }" type="email" :aria-label="t('field.emails')" autocomplete="off">
            <button type="button" class="x hit" :aria-label="t('common.remove')" @click="form.emails.splice(i, 1)"><Icon name="close" :size="18" /></button>
          </div>
        </div>
        <button type="button" class="add hit" @click="form.emails.push('')">{{ t('edit.addEmail') }}</button>

        <label class="f"><span class="lbl">{{ t('field.address') }}<span v-if="ai('address')" class="ai">{{ t('edit.aiBadge') }}</span></span>
          <input v-model="form.address" class="inp" :class="{ ocr: ai('address') }" autocomplete="off"></label>
        <label class="f"><span class="lbl">{{ t('field.website') }}<span v-if="ai('website')" class="ai">{{ t('edit.aiBadge') }}</span></span>
          <input v-model="form.website" class="inp" :class="{ ocr: ai('website') }" type="url" autocomplete="off"></label>

        <h2 class="sub">{{ t('edit.notes') }}</h2>
        <div class="grid2">
          <label class="f"><span class="lbl">{{ t('field.metPlace') }}</span><input v-model="form.metPlace" class="inp" autocomplete="off"></label>
          <label class="f"><span class="lbl">{{ t('field.metAt') }}</span><input v-model="form.metAt" class="inp" type="date"></label>
        </div>
        <div class="f">
          <span class="lbl" id="edit-tags">{{ t('field.tags') }}</span>
          <div class="tags" role="group" aria-labelledby="edit-tags">
            <button v-for="tag in tagChoices" :key="tag" type="button" class="tag hit" :class="{ on: form.tags.includes(tag) }"
              :aria-pressed="form.tags.includes(tag)" @click="toggleTag(tag)">#{{ tag }}</button>
            <input v-if="addingTag" ref="tagInput" v-model="newTag" class="tag-inp" :placeholder="t('capture.newTagPh')" :aria-label="t('capture.newTagPh')"
              enterkeyhint="done" @keydown.enter.prevent="commitTag" @blur="commitTag">
            <button v-else type="button" class="tag new hit" @click="startTag">{{ t('capture.newTag') }}</button>
          </div>
        </div>
        <label class="f"><span class="lbl">{{ t('field.memo') }}</span><textarea v-model="form.memo" rows="4" class="inp area" /></label>
      </form>
    </template>
  </div>
</template>

<style scoped>
.editv { min-height: 100vh; min-height: 100dvh; padding: 0 var(--safe-right) calc(32px + var(--safe-bottom)) var(--safe-left); }
.bar {
  position: sticky; top: 0; z-index: 10; height: calc(56px + var(--safe-top)); padding: var(--safe-top) 8px 0;
  display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); background: var(--surface);
}
:global(.banner-on) .bar { top: 0; height: 56px; padding-top: 0; position: relative; }
.h1 { font-size: 17px; font-weight: 600; }
.hbtn { min-height: 44px; padding: 0 12px; border: 0; background: none; font-size: 15px; color: var(--ink-2); }
.hbtn.strong { font-weight: 700; color: var(--ink); }
.missing { padding: 40px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.msg { margin: 12px 16px 0; display: flex; align-items: flex-start; gap: 6px; font-size: 13px; font-weight: 500; }
.msg.err { color: var(--danger); }
.ainote {
  margin: 12px 16px 0; padding: 10px 12px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-ink);
  font-size: 13px; line-height: 1.45; display: flex; gap: 8px;
}
.ai { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--accent-ink); background: var(--accent-soft); border-radius: 6px; padding: 2px 6px; }
.ai.on-white { background: #FFFFFF; align-self: flex-start; }
.form { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.sub { margin-top: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
.f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.lbl { display: flex; align-items: center; gap: 6px; }
.inp { min-height: 46px; border-radius: 12px; padding: 0 14px; }
.inp.ocr { border-color: #8FA8EA; background: #F7F9FE; }
.area { padding: 12px 14px; line-height: 1.45; resize: vertical; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.select { position: relative; display: block; min-width: 0; }
.select select { appearance: none; -webkit-appearance: none; padding-right: 36px; text-overflow: ellipsis; }
.caret { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.vi { margin-top: -8px; }
.segs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.segsep { color: var(--faint); }
.seg {
  display: inline-flex; align-items: center; height: 36px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--surface);
  padding-left: 10px; max-width: 100%;
}
.seg.ocr { border-color: #8FA8EA; background: #F7F9FE; }
.seg input { border: 0; background: transparent; min-width: 3em; max-width: 60vw; font-size: 14px; padding: 0; height: 34px; font-family: 'Noto Sans JP', var(--font); }
.seg input:focus { outline: none; }
.seg:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.segx { width: 34px; height: 34px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; }
.dashed { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px dashed var(--faint); background: transparent; font-size: 13px; font-weight: 500; color: var(--ink-2); }
.line { display: flex; gap: 8px; align-items: center; }
.line .inp { flex: 1; min-width: 0; }
.type { width: 132px; flex: none; }
.type select { padding-right: 30px; }
.x { width: 44px; height: 44px; flex: none; border: 0; background: none; color: var(--muted); display: grid; place-items: center; border-radius: 10px; }
.add { align-self: flex-start; min-height: 40px; padding: 0 4px; border: 0; background: none; font-size: 14px; font-weight: 600; color: var(--accent); margin-top: -6px; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; }
.tag { height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2); font-size: 13px; font-weight: 500; }
.tag.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
.tag.new { border: 1px dashed var(--faint); background: transparent; }
.tag-inp { height: 36px; width: 140px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--accent); background: var(--surface); font-size: 13px; }
</style>
