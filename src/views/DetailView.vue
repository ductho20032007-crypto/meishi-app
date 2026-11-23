<script setup>
// ③ Card detail — image (front/back, zoom), identity, actions, contact rows with copy, notes, re-read / delete.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { db } from '../services/db.js'
import { getApp } from '../services/app.js'
import { useLive } from '../composables/useLive.js'
import { status } from '../stores/status.js'
import { errorKey } from '../i18n/errors.js'
import { viFor } from '../lib/rank.js'
import { toVCard } from '../lib/vcard.js'

const props = defineProps({ id: { type: String, required: true } })
const { t, locale } = useI18n()
const router = useRouter()

// undefined while loading, then { card: object | null, company }
const data = useLive(async () => {
  const card = await db.cards.get(props.id)
  const company = card?.companyId ? await db.companies.get(card.companyId) : null
  return { card: card || null, company: company || null }
}, undefined)
const card = computed(() => data.value?.card || null)
const company = computed(() => data.value?.company || null)
const companyName = computed(() => company.value?.name || card.value?.companyRaw || '')
const pending = computed(() => card.value?.status === 'pending')

// ---- image (object URL from the local cache / GitHub; revoked on switch + unmount) ----
const side = ref('front')
const imgUrl = ref(null)
const imgState = ref('loading')   // loading | ok | missing
let seq = 0
const setUrl = u => { if (imgUrl.value) URL.revokeObjectURL(imgUrl.value); imgUrl.value = u }
async function loadImage() {
  const c = card.value
  const n = ++seq
  if (!c) return
  if (side.value === 'back' && !c.hasBack) side.value = 'front'
  imgState.value = 'loading'
  let blob = null
  try { blob = await getApp().sync.getImage(`images/${c.id}-${side.value}.jpg`) } catch (e) { console.warn('getImage', e?.kind || e) }
  if (n !== seq) return
  setUrl(blob ? URL.createObjectURL(blob) : null)
  imgState.value = blob ? 'ok' : 'missing'
}
watch(() => [card.value?.id, side.value, card.value?.hasBack], loadImage, { immediate: true })
onBeforeUnmount(() => { seq++; setUrl(null) })
// fullscreen image: a modal <dialog> (focus trap, Esc closes natively)
const zoomDlg = ref(null)
const zoomBig = ref(false)
function openZoom() {
  if (!imgUrl.value || !zoomDlg.value) return
  zoomBig.value = false
  try { zoomDlg.value.showModal() } catch { zoomDlg.value.setAttribute('open', '') }
}
const closeZoom = () => { try { zoomDlg.value?.close() } catch { zoomDlg.value?.removeAttribute('open') } }

// ---- identity ----
const subName = computed(() => [card.value?.nameKana, card.value?.nameLatin].filter(Boolean).join(' · '))
const dept = computed(() => (card.value?.deptPath || []).join(' › '))
const titleVi = computed(() => (card.value?.title ? viFor(card.value.title) : null))
const orgLink = computed(() => card.value?.companyId ? { path: `/company/${card.value.companyId}`, query: { focus: card.value.id } } : null)

// ---- actions ----
const tel = v => `tel:${String(v).replace(/[^\d+#*,;]/g, '')}`
const mainPhone = computed(() => { const p = card.value?.phones || []; return p.find(x => x.type === 'mobile') || p.find(x => x.type !== 'fax') || null })
const mainEmail = computed(() => card.value?.emails?.[0] || '')
const mapUrl = a => `https://maps.google.com/?q=${encodeURIComponent(a)}`
const webUrl = w => (/^https?:\/\//i.test(w) ? w : `https://${w}`)
function saveVCard() {
  const c = card.value
  const url = URL.createObjectURL(new Blob([toVCard(c, companyName.value)], { type: 'text/vcard;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `${(c.name || c.id).replace(/[\\/:*?"<>|]+/g, '_')}.vcf`; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- copy + toast ----
const toast = ref('')
let toastTimer = null
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 1800)
}
onBeforeUnmount(() => clearTimeout(toastTimer))
async function copy(v) {
  try { await navigator.clipboard.writeText(v); showToast(t('detail.copied')) }
  catch { showToast(t('detail.copyFailed')) }
}
const phoneLabel = type => t(`field.phoneType.${['mobile', 'office', 'fax'].includes(type) ? type : 'office'}`)
const hasContact = computed(() => { const c = card.value; return !!(c && (c.phones?.length || c.emails?.length || c.address || c.website)) })

// ---- notes / footer ----
const metDate = computed(() => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(card.value?.metAt || '')
  if (!m) return card.value?.metAt || ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(+m[1], +m[2] - 1, +m[3]))
})
const met = computed(() => [card.value?.metPlace, metDate.value].filter(Boolean).join(' · '))
const hasNotes = computed(() => !!(met.value || card.value?.tags?.length || card.value?.memo))
const updated = computed(() => {
  const d = new Date(card.value?.updatedAt || '')
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
})
const byLine = computed(() => {
  const c = card.value
  const who = pending.value ? t('detail.notRead') : c?.ocrBy === 'gemini' ? t('detail.byGemini') : t('detail.byManual')
  return [who, updated.value].filter(Boolean).join(' · ')
})

// ---- OCR state ----
const running = computed(() => status.ocr?.runningId === props.id)
const queued = computed(() => (status.ocr?.queued || []).includes(props.id))
const pendingTitle = computed(() => running.value ? t('detail.reading') : queued.value ? t('detail.queued') : t('detail.pendingTitle'))
const ocrErr = computed(() => (pending.value && card.value?.ocrError && !running.value) ? t('detail.ocrError', { reason: t(errorKey(card.value.ocrError)) }) : '')
function reread() {
  if (!pending.value && !window.confirm(t('detail.rereadConfirm'))) return
  let p
  try { p = getApp().repo.reread(props.id) } catch (e) { showToast(t(errorKey(e?.kind))); return }
  Promise.resolve(p).catch(e => { console.warn('reread', e?.kind || e); showToast(t(errorKey(e?.kind))) })
}

// ---- delete / navigation ----
const deleting = ref(false)
async function remove() {
  if (!window.confirm(t('detail.deleteConfirm'))) return
  deleting.value = true
  try { await getApp().repo.deleteCard(props.id); router.replace('/') }
  catch (e) { console.warn('deleteCard', e); showToast(t(errorKey(e?.kind))) }
  finally { deleting.value = false }
}
function back() {
  if (router.options.history.state?.back) router.back(); else router.replace('/')
}
</script>

<template>
  <div class="detail">
    <header class="bar">
      <button type="button" class="icon-btn" :aria-label="t('common.back')" @click="back"><Icon name="back" /></button>
      <RouterLink v-if="card" :to="`/card/${id}/edit`" class="edit"><Icon name="edit" :size="18" />{{ t('detail.edit') }}</RouterLink>
    </header>

    <div v-if="data && !card" class="missing">
      <p class="hint">{{ t('detail.notFound') }}</p>
      <RouterLink to="/" class="btn">{{ t('detail.toList') }}</RouterLink>
    </div>

    <template v-else-if="card">
      <section class="media">
        <button type="button" class="photo" :class="imgState" :aria-label="t('detail.enlarge')" :disabled="imgState !== 'ok'" @click="openZoom">
          <img v-if="imgUrl" :src="imgUrl" :alt="side === 'back' ? t('capture.backSide') : t('capture.front')">
          <img v-else-if="card.thumb && imgState === 'missing'" :src="card.thumb" alt="" class="blur">
          <span v-if="imgState === 'missing'" class="img-note">{{ t('detail.imageUnavailable') }}</span>
        </button>
        <div v-if="card.hasBack" class="seg" role="group" :aria-label="t('detail.sides')">
          <button type="button" class="hit" :class="{ on: side === 'front' }" :aria-pressed="side === 'front'" @click="side = 'front'">{{ t('capture.front') }}</button>
          <button type="button" class="hit" :class="{ on: side === 'back' }" :aria-pressed="side === 'back'" @click="side = 'back'">{{ t('capture.backSide') }}</button>
        </div>
      </section>

      <section v-if="pending" class="pending" :class="{ err: ocrErr }" role="status">
        <Icon :name="running ? 'sync' : 'clock'" :size="20" :class="{ spinning: running }" />
        <div class="p-txt">
          <strong>{{ pendingTitle }}</strong>
          <span>{{ t('detail.pendingHint') }}</span>
          <span v-if="ocrErr" class="p-err">{{ ocrErr }}</span>
        </div>
        <button v-if="!running" type="button" class="btn p-btn hit" @click="reread">{{ t('detail.reread') }}</button>
      </section>

      <section class="who">
        <h1 class="name" :class="{ none: !card.name }">{{ card.name || t('detail.noName') }}</h1>
        <span v-if="subName" class="kana">{{ subName }}</span>
        <RouterLink v-if="orgLink && companyName" :to="orgLink" class="co">{{ companyName }}</RouterLink>
        <span v-else-if="companyName" class="co plain">{{ companyName }}</span>
        <span v-if="dept" class="dept">{{ dept }}</span>
        <RouterLink v-if="card.title" :to="{ path: '/titles', query: { q: card.title } }" class="title-chip hit">
          <strong>{{ card.title }}</strong><span v-if="titleVi">· {{ titleVi }}</span>
          <Icon name="book" :size="16" />
        </RouterLink>
      </section>

      <div class="acts">
        <a v-if="mainPhone" class="act" :href="tel(mainPhone.value)"><Icon name="phone" />{{ t('detail.call') }}</a>
        <span v-else class="act off" aria-disabled="true"><Icon name="phone" />{{ t('detail.call') }}</span>
        <a v-if="mainEmail" class="act" :href="`mailto:${mainEmail}`"><Icon name="mail" />{{ t('detail.mail') }}</a>
        <span v-else class="act off" aria-disabled="true"><Icon name="mail" />{{ t('detail.mail') }}</span>
        <a v-if="card.address" class="act" :href="mapUrl(card.address)" target="_blank" rel="noopener"><Icon name="map" />{{ t('detail.map') }}</a>
        <span v-else class="act off" aria-disabled="true"><Icon name="map" />{{ t('detail.map') }}</span>
        <button type="button" class="act" :disabled="!card.name && !companyName" @click="saveVCard"><Icon name="contact" />{{ t('detail.vcard') }}</button>
      </div>

      <div v-if="orgLink" class="org-wrap">
        <RouterLink :to="orgLink" class="org"><Icon name="tree" />{{ t('detail.orgChart') }}</RouterLink>
      </div>

      <template v-if="hasContact">
        <h2 class="sec">{{ t('detail.contact') }}</h2>
        <ul class="rows">
          <li v-for="(p, i) in card.phones" :key="'p' + i" class="fld">
            <div class="fbody"><span class="fk">{{ phoneLabel(p.type) }}</span><a class="fv" :href="tel(p.value)">{{ p.value }}</a></div>
            <button type="button" class="cp" :aria-label="t('detail.copyLabel', { label: phoneLabel(p.type) })" @click="copy(p.value)"><Icon name="copy" :size="20" /></button>
          </li>
          <li v-for="(e, i) in card.emails" :key="'e' + i" class="fld">
            <div class="fbody"><span class="fk">{{ t('field.emails') }}</span><a class="fv ell" :href="`mailto:${e}`">{{ e }}</a></div>
            <button type="button" class="cp" :aria-label="t('detail.copyLabel', { label: t('field.emails') })" @click="copy(e)"><Icon name="copy" :size="20" /></button>
          </li>
          <li v-if="card.address" class="fld">
            <div class="fbody"><span class="fk">{{ t('field.address') }}</span><span class="fv">{{ card.address }}</span></div>
            <button type="button" class="cp" :aria-label="t('detail.copyLabel', { label: t('field.address') })" @click="copy(card.address)"><Icon name="copy" :size="20" /></button>
          </li>
          <li v-if="card.website" class="fld">
            <div class="fbody"><span class="fk">{{ t('field.website') }}</span><a class="fv ell" :href="webUrl(card.website)" target="_blank" rel="noopener">{{ card.website }}</a></div>
            <button type="button" class="cp" :aria-label="t('detail.copyLabel', { label: t('field.website') })" @click="copy(card.website)"><Icon name="copy" :size="20" /></button>
          </li>
        </ul>
      </template>

      <h2 class="sec">{{ t('detail.notes') }}</h2>
      <ul class="rows">
        <li v-if="met" class="fld"><div class="fbody"><span class="fk">{{ card.metPlace ? t('field.metPlace') : t('field.metAt') }}</span><span class="fv">{{ met }}</span></div></li>
        <li v-if="card.tags?.length" class="fld">
          <div class="fbody gap"><span class="fk">{{ t('field.tags') }}</span>
            <span class="tags"><span v-for="tag in card.tags" :key="tag" class="tag">#{{ tag }}</span></span></div>
        </li>
        <li v-if="card.memo" class="fld top"><div class="fbody"><span class="fk">{{ t('field.memo') }}</span><span class="fv memo">{{ card.memo }}</span></div></li>
        <li v-if="!hasNotes" class="fld"><span class="hint">{{ t('detail.noNotes') }}</span></li>
      </ul>

      <footer class="foot">
        <span>{{ byLine }}</span>
        <div class="foot-btns">
          <button v-if="!pending" type="button" class="link" @click="reread">{{ t('detail.reread') }}</button>
          <button type="button" class="link danger" :disabled="deleting" @click="remove">{{ t('detail.delete') }}</button>
        </div>
      </footer>
    </template>

    <dialog ref="zoomDlg" class="zoom" :aria-label="t('detail.enlarge')" @click.self="closeZoom">
      <button type="button" class="z-close" :aria-label="t('detail.closeImage')" @click="closeZoom"><Icon name="close" /></button>
      <div class="z-scroll" @click.self="closeZoom">
        <img v-if="imgUrl" :src="imgUrl" alt="" :class="{ big: zoomBig }" @click="zoomBig = !zoomBig">
      </div>
    </dialog>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<style scoped>
.detail { min-height: 100vh; min-height: 100dvh; padding: var(--safe-top) var(--safe-right) calc(16px + var(--safe-bottom)) var(--safe-left); }
:global(.banner-on) .detail { padding-top: 0; }
.bar { height: 56px; padding: 0 8px; display: flex; align-items: center; justify-content: space-between; }
.icon-btn { width: 44px; height: 44px; border: 0; background: none; display: grid; place-items: center; color: var(--ink); border-radius: 10px; }
.edit { height: 44px; padding: 0 16px; border-radius: 22px; display: flex; align-items: center; gap: 6px; text-decoration: none; font-size: 14px; font-weight: 600; }
.missing { padding: 40px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.media { padding: 0 16px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.photo {
  position: relative; width: 100%; min-height: 160px; padding: 0; border: 0; border-radius: 8px; background: var(--surface); overflow: hidden;
  box-shadow: 0 1px 3px rgba(20, 24, 32, 0.12), 0 8px 20px rgba(20, 24, 32, 0.06); display: grid; place-items: center; cursor: zoom-in;
}
.photo:disabled { opacity: 1; cursor: default; }
.photo.loading { background: linear-gradient(90deg, #EEF0F3, #F7F8FA, #EEF0F3); }
.photo img { width: 100%; max-height: 300px; object-fit: contain; display: block; }
.photo img.blur { filter: blur(1px); opacity: 0.6; }
.img-note { position: absolute; bottom: 8px; left: 8px; right: 8px; font-size: 12px; color: var(--muted); background: rgba(255, 255, 255, 0.9); border-radius: 6px; padding: 4px 8px; }
.seg { display: flex; padding: 3px; border-radius: 10px; background: var(--seg-bg); }
.seg button { height: 34px; padding: 0 16px; border: 0; border-radius: 8px; background: transparent; font-size: 13px; font-weight: 500; color: var(--ink-2); }
.seg button.on { background: var(--surface); font-weight: 600; color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.pending {
  margin: 14px 16px 0; padding: 12px; border-radius: 12px; background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn-ink);
  display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.45;
}
.pending.err { background: var(--danger-bg); border-color: var(--danger-line); color: var(--danger); }
.p-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.p-err { font-weight: 600; }
.p-btn { flex: none; align-self: center; min-height: 40px; padding: 0 12px; font-size: 13px; }
.who { padding: 18px 16px 0; display: flex; flex-direction: column; gap: 4px; }
.name { font-size: 26px; font-weight: 700; letter-spacing: 0.02em; overflow-wrap: anywhere; }
.name.none { color: var(--muted); font-weight: 600; font-size: 22px; }
.kana { font-size: 14px; color: var(--muted); }
.co { margin-top: 6px; font-size: 15px; font-weight: 600; text-decoration: none; }
.co.plain { color: var(--ink); }
.dept { font-size: 14px; color: var(--ink-2); }
.title-chip {
  margin-top: 6px; align-self: flex-start; max-width: 100%; display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 4px 12px;
  border-radius: 17px; background: var(--accent-soft); color: var(--accent-ink); text-decoration: none; font-size: 14px;
}
.title-chip strong { font-weight: 700; }
.acts { padding: 18px 16px 0; display: flex; gap: 8px; }
.act {
  flex: 1; min-width: 0; min-height: 64px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--ink);
  text-decoration: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 500;
}
.act:hover { color: var(--accent); }
.act.off, .act:disabled { color: var(--faint); opacity: 1; }
.org-wrap { padding: 10px 16px 0; }
.org {
  height: 52px; border-radius: 14px; background: var(--ink); color: #FFFFFF; text-decoration: none;
  display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 15px; font-weight: 600;
}
.org:hover { color: #FFFFFF; }
.sec { padding-top: 20px; }
.rows { list-style: none; margin: 0; padding: 0; background: var(--surface); border-top: 1px solid #ECEEF2; }
.fld { display: flex; align-items: center; gap: 12px; padding: 8px 4px 8px 16px; border-bottom: 1px solid #ECEEF2; min-height: 60px; }
.fld.top { align-items: flex-start; padding-top: 12px; padding-bottom: 12px; }
.fbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fbody.gap { gap: 6px; }
.fk { font-size: 12px; color: var(--muted); }
.fv { font-size: 15px; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
a.fv:hover { color: var(--accent); }
.fv.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.memo { line-height: 1.5; white-space: pre-wrap; }
.cp { width: 44px; height: 44px; flex: none; border: 0; background: none; color: var(--muted); display: grid; place-items: center; border-radius: 10px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-size: 13px; padding: 4px 10px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-ink); }
.foot { padding: 18px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); }
.foot-btns { display: flex; gap: 4px; flex: none; }
.link { height: 44px; padding: 0 12px; border: 0; background: none; font-size: 13px; font-weight: 600; color: var(--accent); }
.link.danger { color: var(--danger); }
.zoom {
  position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0;
  background: #0A0C10; color: #FFFFFF; flex-direction: column;
}
.zoom[open] { display: flex; }
.zoom::backdrop { background: #0A0C10; }
.z-close {
  position: absolute; top: calc(8px + var(--safe-top)); right: calc(8px + var(--safe-right)); z-index: 1;
  width: 44px; height: 44px; border: 0; border-radius: 22px; background: rgba(255, 255, 255, 0.15); color: #FFFFFF; display: grid; place-items: center;
}
.z-scroll { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: safe center; touch-action: pan-x pan-y pinch-zoom; }
.z-scroll img { width: 100%; height: auto; display: block; margin: auto; cursor: zoom-in; }
.z-scroll img.big { width: 220%; max-width: none; cursor: zoom-out; }
.toast {
  position: fixed; left: 50%; bottom: calc(24px + var(--safe-bottom)); transform: translateX(-50%); z-index: 60;
  padding: 10px 16px; border-radius: 20px; background: var(--ink); color: #FFFFFF; font-size: 13px; font-weight: 600; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
}
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
