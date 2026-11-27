<script setup>
// ⑥ Org chart (block style) — reporting chain of the focused person, same department, whole-company block chart;
// edit mode: people without a card (placeholders), rename / merge departments, reportsTo, rename company.
import { ref, shallowRef, reactive, computed, watch, nextTick, onMounted, onScopeDispose } from 'vue'
import { liveQuery } from 'dexie'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import Sheet from '../components/Sheet.vue'
import { db } from '../services/db.js'
import { getApp } from '../services/app.js'
import { useLive } from '../composables/useLive.js'
import { buildOrg } from '../lib/orgChart.js'
import { rankFor, viFor } from '../lib/rank.js'
import { RANK_LABELS } from '../data/titles.js'
import { companyStats, companyPeople, chartLevels, deptNodes, nodePath, deptLabel } from '../lib/orgView.js'

const props = defineProps({ id: { type: String, required: true }, focus: { type: String, default: null } })
const { t, locale } = useI18n()
const router = useRouter()

const companies = useLive(() => db.companies.toArray(), null)
// cards of this company only; the live query is recreated when the route reuses the view for another company
const cards = shallowRef([])
let cardsSub = null
watch(() => props.id, id => {
  cardsSub?.unsubscribe()
  cards.value = []
  cardsSub = liveQuery(() => db.cards.where('companyId').equals(id).toArray()).subscribe({
    next: v => { cards.value = v },
    error: e => console.error('liveQuery', e)
  })
}, { immediate: true })
onScopeDispose(() => cardsSub?.unsubscribe())
const company = computed(() => (companies.value || []).find(c => c.id === props.id) || null)
const missing = computed(() => companies.value !== null && !company.value)

const people = computed(() => companyPeople(company.value, cards.value))
const org = computed(() => {
  try { return buildOrg(people.value, company.value?.deptAliases || {}) } catch (e) { console.warn('buildOrg', e); return buildOrg([]) }
})
const stats = computed(() => companyStats(company.value, cards.value))
const meta = computed(() => [t('list.cards', stats.value.cards), stats.value.notMet ? t('companies.notMet', stats.value.notMet) : '']
  .filter(Boolean).join(' · '))

// ---- focus: chain + peers ----
const focused = computed(() => (props.focus && people.value.find(p => p.id === props.focus)) || null)
const chain = computed(() => (focused.value ? org.value.chain(focused.value.id) : []))
const peers = computed(() => (focused.value ? org.value.peers(focused.value.id) : []))
const focusDept = computed(() => {
  const n = focused.value && org.value.nodeOf(focused.value.id)
  if (!n) return ''
  return n.unknown ? t('org.unknownDept') : (n.name || company.value?.name || '')
})
const chart = computed(() => chartLevels(org.value, focused.value?.id || null))

// ---- keep the focus path visible in rows that scroll horizontally ----
const chartEl = ref(null)
function scrollToPath() {
  for (const row of chartEl.value?.querySelectorAll('.row.wide') || []) {
    const box = row.querySelector('.box.deep') || row.querySelector('.box.on')
    if (!box) continue
    const r = row.getBoundingClientRect(), b = box.getBoundingClientRect()
    const left = row.scrollLeft + (b.left - r.left) - (r.width - b.width) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: 'auto' })
  }
}
const pathSig = computed(() => `${focused.value?.id || ''}|${chart.value.deepest || ''}|${chart.value.levels.map(l => l.count).join(',')}`)
watch(pathSig, () => nextTick(scrollToPath))
onMounted(() => nextTick(scrollToPath))

// ---- person text ----
const nameOf = p => p?.name || t('detail.noName')
const initialOf = p => [...(p?.name || '?').trim()][0] || '?'
const vi = p => (p?.title ? viFor(p.title) : null)
const chainLine = p => [deptLabel(org.value, p.id), p.title, vi(p)].filter(Boolean).join(' · ')
const peerLine = p => [p.title, vi(p)].filter(Boolean).join(' · ')
const shortHead = p => (p ? [String(p.name || '').trim().split(/\s+/)[0], p.title].filter(Boolean).join(' ') : '')
const boxName = n => (n.unknown ? t('org.unknownDept') : n.name)

// ---- header ----
function back() {
  if (router.options.history.state?.back) router.back()
  else router.replace('/companies')
}
const editing = ref(false)

// ---- block sheet (people of one node, grouped by sub-department) ----
const blockKey = ref(null)        // '' = whole company, null = closed
function findNode(key, n = org.value.root) {
  if (n.key === key) return n
  for (const c of n.children) { const f = findNode(key, c); if (f) return f }
  return null
}
const block = computed(() => {
  if (blockKey.value === null) return null
  const node = findNode(blockKey.value)
  if (!node) return null
  const sections = []
  ;(function walk(n, trail) {
    if (n.people.length) sections.push({ key: n.key || '__root', label: trail.join(' › '), people: n.people })
    for (const c of n.children) walk(c, [...trail, c.unknown ? t('org.unknownDept') : c.name])
  })(node, node === org.value.root ? [company.value?.name || ''] : [boxName(node)])
  return { node, title: node === org.value.root ? company.value?.name || '' : boxName(node), sections }
})
watch(block, b => { if (blockKey.value !== null && !b) blockKey.value = null })
const openBlock = key => { blockKey.value = key }

// ---- person sheet: add / edit placeholder, reportsTo of a card ----
const NEW_ID = '__new'
const person = reactive({ open: false, mode: 'add', id: null, name: '', title: '', deptPath: [], rank: null, reportsTo: null, memo: '', rankTouched: false, error: '', saving: false })
let personLoaded = false
function openPerson(p, presetPath = []) {
  blockKey.value = null
  personLoaded = false
  segInputs.value = []
  const boss = p?.reportsTo && p.reportsTo !== p.id && people.value.some(x => x.id === p.reportsTo) ? p.reportsTo : null
  Object.assign(person, {
    open: true, error: '', saving: false,
    mode: !p ? 'add' : p.placeholder ? 'ph' : 'card', id: p?.id || null,
    name: p?.name || '', title: p?.title || '', deptPath: [...(p?.deptPath || presetPath)],
    rank: p?.rank ?? null, reportsTo: boss, memo: p?.memo || ''
  })
  person.rankTouched = !!p && p.rank != null && p.rank !== rankFor(p.title || '')
  nextTick(() => { personLoaded = true })
}
watch(() => person.title, v => { if (personLoaded && !person.rankTouched) person.rank = v.trim() ? rankFor(v) : null })
const personVi = computed(() => (person.title.trim() ? viFor(person.title) : null))
const rankLabel = n => `${n} · ${RANK_LABELS[n]?.[locale.value] || RANK_LABELS[n]?.en || ''}`
const selfId = computed(() => person.id || NEW_ID)
const bossOptions = computed(() => people.value.filter(p => p.id !== selfId.value)
  .map(p => ({ id: p.id, label: p.placeholder ? t('edit.noCard', { name: personText(p) }) : personText(p) })))
const personText = p => [nameOf(p), p.title ? `(${p.title})` : ''].filter(Boolean).join(' ')
const inferredBoss = computed(() => {
  if (!person.open) return null
  const cur = people.value.find(p => p.id === person.id)
  const self = person.mode === 'card'
    ? { ...cur, reportsTo: null }
    : { id: selfId.value, name: person.name, title: person.title, rank: person.rank ?? rankFor(person.title), deptPath: person.deptPath.map(s => s.trim()).filter(Boolean), reportsTo: null, placeholder: true }
  try { return buildOrg([...people.value.filter(p => p.id !== selfId.value), self], company.value?.deptAliases || {}).bossOf(selfId.value) }
  catch { return null }
})
watch(bossOptions, list => { if (person.reportsTo && !list.some(o => o.id === person.reportsTo)) person.reportsTo = null })
const deptChoices = computed(() => deptNodes(org.value))
const pickDept = ref('')
watch(pickDept, key => {
  if (!key) return
  person.deptPath = nodePath(org.value, key)
  pickDept.value = ''
})
const segInputs = ref([])
async function addLevel() {
  person.deptPath.push('')
  await nextTick()
  segInputs.value[person.deptPath.length - 1]?.focus()
}
const segWidth = s => `calc(${[...(s || '')].reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 1 : 0.6), 0) + 1.2}em + 26px)`
const personTitle = computed(() => person.mode === 'add' ? t('org.addTitle')
  : person.mode === 'ph' ? t('org.editTitle') : `${t('org.bossTitle')} · ${person.name || t('detail.noName')}`)

async function savePerson() {
  if (person.saving) return
  person.error = ''
  const repo = getApp().repo
  try {
    if (person.mode === 'card') {
      person.saving = true
      await repo.updateCard(person.id, { reportsTo: person.reportsTo || null })
    } else {
      const name = person.name.trim()
      if (!name) { person.error = t('org.nameRequired'); return }
      person.saving = true
      const data = {
        name, title: person.title.trim(), deptPath: person.deptPath.map(s => s.trim()).filter(Boolean),
        rank: person.rank ?? rankFor(person.title.trim()), reportsTo: person.reportsTo || null, memo: person.memo.trim()
      }
      if (person.mode === 'add') await repo.addPlaceholder(props.id, data)
      else await repo.updatePlaceholder(props.id, person.id, data)
    }
    person.open = false
  } catch (e) {
    console.warn('savePerson', e)
    person.error = t('edit.failed')
  } finally { person.saving = false }
}
async function removePerson() {
  if (person.mode !== 'ph' || !window.confirm(t('org.removeConfirm', { name: person.name || t('detail.noName') }))) return
  try {
    person.saving = true
    await getApp().repo.removePlaceholder(props.id, person.id)
    person.open = false
  } catch (e) {
    console.warn('removePerson', e)
    person.error = t('edit.failed')
  } finally { person.saving = false }
}

// ---- department sheet: rename / merge (writes deptAliases) ----
const dept = reactive({ open: false, key: '', newName: '', mergeTo: '', error: '', saving: false })
function openDept(key = '') {
  blockKey.value = null
  const first = deptChoices.value[0]?.key || ''
  Object.assign(dept, { open: true, key: key || first, newName: '', mergeTo: '', error: '', saving: false })
}
const deptFrom = computed(() => deptChoices.value.find(d => d.key === dept.key) || null)
// path-scoped aliases: a department can only be merged into a sibling (same parent)
const mergeChoices = computed(() => [...new Set(deptChoices.value
  .filter(d => deptFrom.value && d.parentKey === deptFrom.value.parentKey && d.key !== deptFrom.value.key).map(d => d.name))])
watch(() => dept.newName, v => { if (v.trim()) dept.mergeTo = '' })
watch(() => dept.mergeTo, v => { if (v) dept.newName = '' })
watch(() => dept.key, () => { dept.mergeTo = '' })
async function saveDept() {
  if (dept.saving || !deptFrom.value) return
  const to = dept.newName.trim() || dept.mergeTo
  if (!to) { dept.error = t('org.newNameRequired'); return }
  dept.saving = true; dept.error = ''
  try {
    await getApp().repo.setDeptAlias(props.id, deptFrom.value.sources, to)
    dept.open = false
  } catch (e) {
    console.warn('saveDept', e)
    dept.error = t('edit.failed')
  } finally { dept.saving = false }
}

// ---- company sheet ----
const co = reactive({ open: false, name: '', error: '', saving: false })
const openCompany = () => Object.assign(co, { open: true, name: company.value?.name || '', error: '', saving: false })
async function saveCompany() {
  if (co.saving) return
  if (!co.name.trim()) { co.error = t('org.companyNameRequired'); return }
  co.saving = true; co.error = ''
  try {
    await getApp().repo.renameCompany(props.id, co.name.trim())
    co.open = false
  } catch (e) {
    console.warn('saveCompany', e)
    co.error = t('edit.failed')
  } finally { co.saving = false }
}

// people list in edit mode: by department order of the tree
const allPeople = computed(() => {
  const out = []
  ;(function walk(n) { out.push(...n.people); n.children.forEach(walk) })(org.value.root)
  return out
})
</script>

<template>
  <div class="org">
    <header class="bar">
      <button type="button" class="icon-btn" :aria-label="t('common.back')" @click="back"><Icon name="back" /></button>
      <div v-if="company" class="ttl">
        <h1 class="h1">{{ company.name }}</h1>
        <span class="meta">{{ meta }}</span>
      </div>
      <span v-else class="ttl" />
      <button v-if="company" type="button" class="edit-btn" :class="{ on: editing }" :aria-pressed="editing" @click="editing = !editing">
        <Icon :name="editing ? 'check' : 'edit'" :size="18" />{{ editing ? t('org.done') : t('org.edit') }}
      </button>
    </header>

    <div v-if="missing" class="missing">
      <p class="hint">{{ t('org.notFound') }}</p>
      <RouterLink to="/companies" class="btn">{{ t('org.toList') }}</RouterLink>
    </div>

    <template v-else-if="company">
      <!-- edit mode tools -->
      <section v-if="editing" class="tools" :aria-label="t('org.edit')">
        <p class="note">{{ t('org.editing') }}</p>
        <div class="tool-btns">
          <button type="button" class="btn" @click="openPerson(null)"><Icon name="plus" :size="18" />{{ t('org.addPerson') }}</button>
          <button type="button" class="btn" :disabled="!deptChoices.length" @click="openDept()"><Icon name="tree" :size="18" />{{ t('org.renameDept') }}</button>
          <button type="button" class="btn" @click="openCompany"><Icon name="building" :size="18" />{{ t('org.renameCompany') }}</button>
        </div>
        <template v-if="allPeople.length">
          <h2 class="sec flush">{{ t('org.peopleList') }}</h2>
          <ul class="plist">
            <li v-for="p in allPeople" :key="p.id">
              <button type="button" class="prow" :class="{ ph: p.placeholder }" :aria-label="t('org.editPersonLabel', { name: nameOf(p) })" @click="openPerson(p)">
                <span class="av sm" :class="{ ph: p.placeholder }">{{ initialOf(p) }}</span>
                <span class="ptxt">
                  <span class="nm">{{ nameOf(p) }}<span v-if="p.placeholder" class="nm-note">{{ t('org.notMet') }}</span></span>
                  <span class="tt">{{ chainLine(p) }}</span>
                </span>
                <Icon name="edit" :size="18" class="chev" />
              </button>
            </li>
          </ul>
        </template>
      </section>

      <!-- (1) reporting chain -->
      <template v-if="focused">
        <h2 class="sec">{{ t('org.chainOf', { name: nameOf(focused) }) }}</h2>
        <ol class="chain">
          <li v-for="(p, i) in chain" :key="p.id" class="step">
            <span v-if="i > 0" class="link" :class="{ on: p.id === focused.id }" aria-hidden="true" />
            <component :is="editing ? 'button' : (!p.placeholder && p.id !== focused.id ? 'RouterLink' : 'div')"
              :type="editing ? 'button' : undefined" :to="!editing && !p.placeholder && p.id !== focused.id ? `/card/${p.id}` : undefined"
              class="pc" :class="{ ph: p.placeholder, me: p.id === focused.id, tap: editing || (!p.placeholder && p.id !== focused.id) }"
              :aria-current="p.id === focused.id ? 'true' : undefined" @click="editing && openPerson(p)">
              <span class="av" :class="{ ph: p.placeholder }">{{ initialOf(p) }}</span>
              <span class="ptxt">
                <span class="nm">{{ nameOf(p) }}<span v-if="p.placeholder" class="nm-note">{{ t('org.notMet') }}</span></span>
                <span class="tt">{{ chainLine(p) }}</span>
              </span>
              <span v-if="p.id === focused.id" class="pill">{{ t('org.viewing') }}</span>
            </component>
          </li>
        </ol>

        <!-- (2) same department -->
        <h2 class="sec">{{ t('org.sameDept', { name: focusDept }) }}</h2>
        <p v-if="!peers.length" class="hint pad">{{ t('org.sameDeptNone') }}</p>
        <div v-else class="peers">
          <component :is="editing ? 'button' : (p.placeholder ? 'div' : 'RouterLink')" v-for="p in peers" :key="p.id"
            :type="editing ? 'button' : undefined" :to="!editing && !p.placeholder ? `/card/${p.id}` : undefined"
            class="peer" :class="{ ph: p.placeholder, tap: editing || !p.placeholder }" @click="editing && openPerson(p)">
            <span class="av" :class="{ ph: p.placeholder }">{{ initialOf(p) }}</span>
            <span class="nm">{{ nameOf(p) }}</span>
            <span class="tt">{{ peerLine(p) || '—' }}</span>
          </component>
        </div>
      </template>

      <!-- (3) whole company -->
      <h2 class="sec">{{ t('org.whole') }}</h2>
      <p v-if="!focused && people.length" class="hint pad hint-top">{{ t('org.pickHint') }}</p>
      <div ref="chartEl" class="chart">
        <button type="button" class="box root" :class="{ on: chart.root.onPath && !chart.deepest }" :aria-current="chart.root.onPath && !chart.deepest ? 'true' : undefined" @click="openBlock('')">
          <span class="bn">{{ company.name }}</span>
          <span class="bm">{{ chart.root.head ? shortHead(chart.root.head) : t('org.people', chart.root.total) }}</span>
        </button>
        <div v-for="(lv, i) in chart.levels" :key="i" class="lvl">
          <span v-if="i === 0 || chart.levels[i - 1].count === 1" class="vl" :class="{ on: lv.groups.some(g => g.onPath) }" aria-hidden="true" />
          <div class="row" :class="{ wide: lv.wide }">
            <div v-for="g in lv.groups" :key="g.parentKey" class="grp" :style="{ '--n': g.nodes.length, flex: lv.wide ? 'none' : g.nodes.length }">
              <span v-if="i > 0 && chart.levels[i - 1].count > 1" class="pname" :class="{ on: g.onPath }">
                <Icon name="chevronDown" :size="12" />{{ g.parentUnknown ? t('org.unknownDept') : g.parentName }}
              </span>
              <span v-if="g.nodes.length > 1" class="hbar" aria-hidden="true" />
              <div class="cols">
                <div v-for="n in g.nodes" :key="n.key" class="col">
                  <span class="vl stub" :class="{ on: n.onPath }" aria-hidden="true" />
                  <button type="button" class="box" :class="{ on: n.onPath, deep: n.deepest, unk: n.unknown }"
                    :aria-current="n.deepest ? 'true' : undefined" @click="openBlock(n.key)">
                    <span class="bn">{{ boxName(n) }}</span>
                    <span v-if="n.onPath" class="visually-hidden">{{ t('org.onPath') }}</span>
                    <span v-if="n.head" class="bm">{{ shortHead(n.head) }}</span>
                    <span class="bm">{{ t('org.people', n.total) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="hint center chart-hint">{{ people.length ? t('org.tapBox') : t('org.empty') }}</p>
      </div>

      <div class="legend">
        <span v-if="focused"><span class="sw path" />{{ t('org.legendPath') }}</span>
        <span v-if="stats.notMet"><span class="sw dash" />{{ t('org.legendNoCard') }}</span>
      </div>
    </template>

    <!-- block sheet -->
    <Sheet v-if="block" :title="t('org.blockPeople', { name: block.title })" @close="blockKey = null">
      <p v-if="!block.sections.length" class="hint">{{ t('org.noPeople') }}</p>
      <section v-for="s in block.sections" :key="s.key" class="bsec">
        <h3 v-if="block.sections.length > 1 || s.label !== block.title" class="bsec-t">{{ s.label }}</h3>
        <ul class="plist">
          <li v-for="p in s.people" :key="p.id">
            <component :is="editing ? 'button' : (p.placeholder ? 'div' : 'RouterLink')" :type="editing ? 'button' : undefined"
              :to="!editing && !p.placeholder ? `/card/${p.id}` : undefined" class="prow" :class="{ ph: p.placeholder }"
              @click="editing && openPerson(p)">
              <span class="av sm" :class="{ ph: p.placeholder }">{{ initialOf(p) }}</span>
              <span class="ptxt">
                <span class="nm">{{ nameOf(p) }}<span v-if="p.placeholder" class="nm-note">{{ t('org.notMet') }}</span></span>
                <span class="tt">{{ peerLine(p) || '—' }}</span>
              </span>
              <Icon v-if="editing || !p.placeholder" :name="editing ? 'edit' : 'chevron'" :size="18" class="chev" />
            </component>
          </li>
        </ul>
      </section>
      <div v-if="editing" class="sheet-acts">
        <button type="button" class="btn" @click="openPerson(null, block.node.unknown ? [] : nodePath(org, block.node.key))"><Icon name="plus" :size="18" />{{ t('org.addPerson') }}</button>
        <button v-if="block.node.key && !block.node.unknown" type="button" class="btn" @click="openDept(block.node.key)"><Icon name="edit" :size="18" />{{ t('org.renameDept') }}</button>
      </div>
    </Sheet>

    <!-- person sheet -->
    <Sheet v-if="person.open" :title="personTitle" @close="person.open = false">
      <form class="form" @submit.prevent="savePerson">
        <p v-if="person.error" class="err" role="alert"><Icon name="alert" :size="16" />{{ person.error }}</p>
        <template v-if="person.mode !== 'card'">
          <label class="f"><span class="lbl">{{ t('field.name') }}</span>
            <input v-model="person.name" class="inp" autocomplete="off"></label>
          <div class="grid2">
            <label class="f"><span class="lbl">{{ t('field.title') }}</span>
              <input v-model="person.title" class="inp" autocomplete="off"></label>
            <label class="f"><span class="lbl">{{ t('field.rank') }}</span>
              <span class="select">
                <select v-model="person.rank" class="inp" @change="person.rankTouched = true">
                  <option :value="null">{{ t('edit.rankUnset') }}</option>
                  <option v-for="n in 7" :key="n" :value="n">{{ rankLabel(n) }}</option>
                </select>
                <Icon name="chevronDown" :size="18" class="caret" />
              </span>
            </label>
          </div>
          <span v-if="personVi" class="hint vi">{{ t('edit.viHint', { vi: personVi }) }}</span>
          <div class="f">
            <span id="ph-dept" class="lbl">{{ t('edit.deptHint') }}</span>
            <div class="segs" role="group" aria-labelledby="ph-dept">
              <template v-for="(s, i) in person.deptPath" :key="i">
                <Icon v-if="i > 0" name="chevron" :size="16" class="segsep" />
                <span class="seg">
                  <input :ref="el => { segInputs[i] = el }" v-model="person.deptPath[i]" :style="{ width: segWidth(s) }" :aria-label="t('edit.levelLabel', { n: i + 1 })" autocomplete="off">
                  <button type="button" class="segx hit" :aria-label="t('edit.removeLevel', { name: s || i + 1 })" @click="person.deptPath.splice(i, 1)"><Icon name="close" :size="14" /></button>
                </span>
              </template>
              <button type="button" class="dashed hit" @click="addLevel">{{ t('edit.addLevel') }}</button>
            </div>
            <span v-if="deptChoices.length" class="select">
              <select v-model="pickDept" class="inp" :aria-label="t('org.deptPick')">
                <option value="">{{ t('org.deptPick') }} …</option>
                <option v-for="d in deptChoices" :key="d.key" :value="d.key">{{ d.label }}</option>
              </select>
              <Icon name="chevronDown" :size="18" class="caret" />
            </span>
          </div>
        </template>
        <p v-else class="hint">{{ t('org.bossHint', { name: person.name || t('detail.noName') }) }}</p>

        <label class="f"><span class="lbl">{{ t('field.reportsTo') }}</span>
          <span class="select">
            <select v-model="person.reportsTo" class="inp">
              <option :value="null">{{ inferredBoss ? t('edit.auto', { name: personText(inferredBoss) }) : t('edit.autoNone') }}</option>
              <option v-for="o in bossOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
            </select>
            <Icon name="chevronDown" :size="18" class="caret" />
          </span>
        </label>
        <label v-if="person.mode !== 'card'" class="f"><span class="lbl">{{ t('field.memo') }}</span>
          <textarea v-model="person.memo" rows="3" class="inp area" /></label>
        <RouterLink v-if="person.mode === 'card'" :to="`/card/${person.id}/edit`" class="link-row">{{ t('org.openCard') }}<Icon name="chevron" :size="16" /></RouterLink>
        <button v-if="person.mode === 'ph'" type="button" class="btn danger" :disabled="person.saving" @click="removePerson"><Icon name="trash" :size="18" />{{ t('org.removePerson') }}</button>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="person.open = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="person.saving" @click="savePerson">{{ t('common.save') }}</button>
      </template>
    </Sheet>

    <!-- department sheet -->
    <Sheet v-if="dept.open" :title="t('org.renameDept')" @close="dept.open = false">
      <form class="form" @submit.prevent="saveDept">
        <p v-if="dept.error" class="err" role="alert"><Icon name="alert" :size="16" />{{ dept.error }}</p>
        <label class="f"><span class="lbl">{{ t('org.deptPick') }}</span>
          <span class="select">
            <select v-model="dept.key" class="inp">
              <option v-for="d in deptChoices" :key="d.key" :value="d.key">{{ d.label }}</option>
            </select>
            <Icon name="chevronDown" :size="18" class="caret" />
          </span>
        </label>
        <label class="f"><span class="lbl">{{ t('org.newName') }}</span>
          <input v-model="dept.newName" class="inp" autocomplete="off" :placeholder="deptFrom?.name"></label>
        <label v-if="mergeChoices.length" class="f"><span class="lbl">{{ t('org.mergeInto') }}</span>
          <span class="select">
            <select v-model="dept.mergeTo" class="inp">
              <option value="">{{ t('org.mergeNone') }}</option>
              <option v-for="n in mergeChoices" :key="n" :value="n">{{ n }}</option>
            </select>
            <Icon name="chevronDown" :size="18" class="caret" />
          </span>
        </label>
        <p class="hint">{{ t('org.renameHint') }}</p>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="dept.open = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="dept.saving" @click="saveDept">{{ t('common.save') }}</button>
      </template>
    </Sheet>

    <!-- company sheet -->
    <Sheet v-if="co.open" :title="t('org.renameCompany')" @close="co.open = false">
      <form class="form" @submit.prevent="saveCompany">
        <p v-if="co.error" class="err" role="alert"><Icon name="alert" :size="16" />{{ co.error }}</p>
        <label class="f"><span class="lbl">{{ t('field.companyName') }}</span>
          <input v-model="co.name" class="inp" autocomplete="off"></label>
      </form>
      <template #foot>
        <button type="button" class="btn" @click="co.open = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="co.saving" @click="saveCompany">{{ t('common.save') }}</button>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.org { min-height: 100vh; min-height: 100dvh; padding: var(--safe-top) var(--safe-right) calc(32px + var(--safe-bottom)) var(--safe-left); }
:global(.banner-on) .org { padding-top: 0; }
.bar { min-height: 56px; padding: 4px 8px 0; display: flex; align-items: center; gap: 4px; }
.icon-btn { width: 44px; height: 44px; flex: none; border: 0; background: none; display: grid; place-items: center; color: var(--ink); border-radius: 10px; }
.ttl { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.h1 { font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edit-btn {
  flex: none; height: 44px; padding: 0 14px; border-radius: 22px; border: 1px solid var(--line-2); background: var(--surface);
  display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--accent);
}
.edit-btn.on { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
.missing { padding: 40px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.sec { margin: 0; padding: 22px 16px 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
.sec.flush { padding: 8px 0 0; }
.pad { padding: 0 16px; }
.hint-top { margin-bottom: 10px; }
.center { text-align: center; }

/* edit tools */
.tools { margin: 12px 16px 0; padding: 14px; border-radius: var(--radius-card); background: var(--surface); border: 1.5px solid #8FA8EA; display: flex; flex-direction: column; gap: 10px; }
.note { font-size: 13px; color: var(--accent-ink); background: var(--accent-soft); border-radius: 10px; padding: 8px 10px; line-height: 1.45; }
.tool-btns { display: flex; flex-direction: column; gap: 8px; }
.tool-btns .btn { justify-content: flex-start; }

/* person cards */
.av {
  width: 40px; height: 40px; flex: none; border-radius: 20px; background: var(--accent-soft); color: var(--accent-ink);
  display: grid; place-items: center; font: 700 15px 'Noto Sans JP', var(--font);
}
.av.sm { width: 34px; height: 34px; font-size: 14px; }
.av.ph { background: transparent; border: 1.5px dashed var(--faint); color: var(--muted); }
.nm { font: 600 15px 'Noto Sans JP', var(--font); overflow-wrap: anywhere; }
.nm-note { margin-left: 4px; font-weight: 400; font-size: 12px; color: var(--muted); }
.tt { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.ptxt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; text-align: left; }
.chain { list-style: none; margin: 0; padding: 0 16px; display: flex; flex-direction: column; }
.step { display: flex; flex-direction: column; }
.link { width: 2px; height: 18px; background: #C5C9D1; margin-left: 33px; }
.link.on { width: 3px; background: var(--accent); }
.pc {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 10px 14px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--line); text-decoration: none; color: var(--ink); font: inherit; text-align: left;
}
.pc.tap:hover { border-color: #8FA8EA; color: var(--ink); }
.pc.ph { border: 1.5px dashed #B8BDC7; background: transparent; }
.pc.me { background: var(--accent); border-color: var(--accent); color: #FFFFFF; box-shadow: 0 6px 16px rgba(47, 91, 211, 0.3); }
.pc.me .av { background: #FFFFFF; color: var(--accent); border: 0; }
.pc.me .tt, .pc.me .nm-note { color: #DCE5FA; }
.pill { flex: none; font-size: 11px; font-weight: 700; background: rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 3px 8px; }
.peers { padding: 0 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.peer {
  border-radius: 14px; background: var(--surface); border: 1px solid var(--line); padding: 14px 10px; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; text-decoration: none; color: var(--ink); font: inherit;
}
.peer.tap:hover { border-color: #8FA8EA; color: var(--ink); }
.peer.ph { border: 1.5px dashed #B8BDC7; background: transparent; }

/* block chart */
.chart { margin: 0 16px; padding: 18px 12px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); }
.box {
  width: 100%; min-height: 56px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line-2); padding: 8px 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; color: var(--ink); font: inherit;
}
.box .bn { font: 600 13px 'Noto Sans JP', var(--font); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box .bm { font-size: 11px; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box.root { width: 200px; max-width: 100%; margin: 0 auto; background: var(--ink); border-color: var(--ink); color: #FFFFFF; padding: 10px 8px; }
.box.root .bn { font-size: 14px; }
.box.root .bm { color: #C5C9D1; }
.box.root.on { box-shadow: 0 0 0 3px var(--accent); }
.box.on { border: 2px solid var(--accent); }
.box.deep { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
.box.deep .bm { color: #DCE5FA; }
.box.unk { border-style: dashed; }
.box.unk .bn { font-weight: 500; color: var(--ink-2); }
.box.deep.unk .bn { color: #FFFFFF; }
.vl { display: block; width: 2px; height: 16px; margin: 0 auto; background: #B8BDC7; }
.vl.on { background: var(--accent); }
.vl.stub { height: 12px; }
.row { display: flex; gap: 12px; }
.row.wide { overflow-x: auto; margin: 0 -12px; padding: 0 12px 6px; scroll-snap-type: x proximity; }
.grp { min-width: 0; display: flex; flex-direction: column; }
.row.wide .grp { flex: none; }
.pname { display: flex; align-items: center; gap: 2px; justify-content: center; margin-top: 10px; font-size: 11px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pname.on { color: var(--accent); }
.hbar { display: block; height: 2px; background: #B8BDC7; margin: 0 calc((100% - (var(--n) - 1) * 8px) / var(--n) / 2); }
.cols { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 8px; }
.row.wide .cols { grid-template-columns: repeat(var(--n), 112px); }
.row.wide .col { scroll-snap-align: start; }
.col { display: flex; flex-direction: column; min-width: 0; }
.chart-hint { margin-top: 16px; }
.legend { margin: 16px 16px 0; display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--ink-2); }
.legend > span { display: flex; align-items: center; gap: 6px; }
.sw { width: 14px; height: 14px; border-radius: 4px; }
.sw.path { background: var(--accent); }
.sw.dash { border-radius: 7px; border: 1.5px dashed var(--faint); }

/* sheets */
.plist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.prow {
  width: 100%; min-height: 56px; display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--line); text-decoration: none; color: var(--ink); font: inherit; text-align: left;
}
a.prow:hover, button.prow:hover { border-color: #8FA8EA; color: var(--ink); }
.prow.ph { border: 1.5px dashed #B8BDC7; background: transparent; }
.chev { color: var(--faint); }
.bsec { display: flex; flex-direction: column; gap: 6px; }
.bsec-t { font-size: 12px; font-weight: 600; color: var(--muted); }
.sheet-acts { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.sheet-acts .btn { justify-content: flex-start; }
.form { display: flex; flex-direction: column; gap: 14px; }
.f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.err { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--danger); }
.inp { min-height: 46px; border-radius: 12px; padding: 0 14px; }
.area { padding: 12px 14px; line-height: 1.45; resize: vertical; }
.grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.select { position: relative; display: block; min-width: 0; }
.select select { appearance: none; -webkit-appearance: none; padding-right: 36px; text-overflow: ellipsis; }
.caret { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.vi { margin-top: -6px; }
.segs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.segsep { color: var(--faint); }
.seg { display: inline-flex; align-items: center; height: 36px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--surface); padding-left: 10px; max-width: 100%; }
.seg input { border: 0; background: transparent; min-width: 3em; max-width: 60vw; font-size: 14px; padding: 0; height: 34px; font-family: 'Noto Sans JP', var(--font); }
.seg input:focus { outline: none; }
.seg:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.segx.hit::before { width: 100%; }
.segx { width: 34px; height: 34px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; }
.dashed { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px dashed var(--faint); background: transparent; font-size: 13px; font-weight: 500; color: var(--ink-2); }
.link-row { display: flex; align-items: center; gap: 4px; min-height: 44px; font-size: 14px; font-weight: 600; text-decoration: none; }
</style>
