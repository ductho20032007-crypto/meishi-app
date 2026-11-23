<script setup>
// ② Capture / confirm — native camera via a file input, rotate, optional back side, quick notes, save (OCR runs async).
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { db } from '../services/db.js'
import { getApp } from '../services/app.js'
import { useLive } from '../composables/useLive.js'
import { status } from '../stores/status.js'
import { prepareImage, makeThumb } from '../lib/image.js'
import { cardTags, todayLocal } from '../lib/listing.js'

const { t } = useI18n()
const router = useRouter()

// ---- images ----
const sides = reactive({ front: null, back: null })     // { file, rotate, blob, url }
const current = ref('front')
const preparing = ref(false)
const error = ref('')
const note = ref('')
const input = ref(null)
let target = 'front'
let alive = true

function openCamera(side) {
  target = side
  if (!input.value) return
  input.value.value = ''
  input.value.click()
}
const release = s => { if (s?.url) URL.revokeObjectURL(s.url) }
async function setSide(side, file, rotate) {
  preparing.value = true; error.value = ''; note.value = ''
  try {
    const blob = await prepareImage(file, { rotate })
    if (!alive) return   // left the page while the image was being prepared
    release(sides[side])
    sides[side] = { file, rotate, blob, url: URL.createObjectURL(blob) }
    current.value = side
  } catch (e) {
    if (!alive) return
    error.value = e?.kind === 'unsupported_image' ? t('capture.unsupported') : t('capture.failed')
  } finally { preparing.value = false }
}
function onFile(e) {
  const file = e.target.files?.[0]
  if (file) setSide(target, file, 0)
}
function rotate() {
  const s = sides[current.value]
  if (s && !preparing.value) setSide(current.value, s.file, (s.rotate + 90) % 360)
}
function removeBack() {
  release(sides.back); sides.back = null; current.value = 'front'
}
const shown = computed(() => sides[current.value] || sides.front)
const hasImages = computed(() => !!(sides.front || sides.back))

// ---- quick notes ----
const allCards = useLive(() => db.cards.toArray(), [])
const form = reactive({ metPlace: '', metAt: todayLocal(), tags: [], memo: '' })
const tagChoices = computed(() => [...new Set([...cardTags(allCards.value || []), ...form.tags])])
const toggleTag = tag => { form.tags = form.tags.includes(tag) ? form.tags.filter(x => x !== tag) : [...form.tags, tag] }
const adding = ref(false)
const newTag = ref('')
const tagInput = ref(null)
async function startTag() { adding.value = true; await nextTick(); tagInput.value?.focus() }
function commitTag() {
  const tag = newTag.value.replace(/^#+/, '').trim()
  if (tag && !form.tags.includes(tag)) form.tags = [...form.tags, tag]
  newTag.value = ''; adding.value = false
}

// ---- save ----
const saving = ref(false)
async function save(next) {
  if (saving.value) return
  if (!sides.front) { openCamera('front'); return }
  if (adding.value) commitTag()
  saving.value = true; error.value = ''; note.value = ''
  try {
    const thumb = await makeThumb(sides.front.blob)
    const id = await getApp().repo.createCard({
      front: sides.front.blob, back: sides.back?.blob || null, thumb,
      metPlace: form.metPlace.trim(), metAt: form.metAt, tags: [...form.tags], memo: form.memo.trim()
    })
    if (!next) { clearImages(); router.replace(`/card/${id}`); return }
    // next card: usually the same event, so place / date / tags are kept
    clearImages(); form.memo = ''; current.value = 'front'
    note.value = t('capture.saved')   // the big "take photo" tile is shown again (no auto-open after an await)
  } catch (e) {
    console.warn('createCard', e)
    error.value = e?.kind === 'unsupported_image' ? t('capture.unsupported') : t('capture.failed')
  } finally { saving.value = false }
}
function clearImages() { release(sides.front); release(sides.back); sides.front = null; sides.back = null }

function back() {
  if (hasImages.value && !window.confirm(t('capture.discard'))) return
  if (router.options.history.state?.back) router.back(); else router.replace('/')
}

onMounted(() => openCamera('front'))
onBeforeUnmount(() => { alive = false; clearImages() })
</script>

<template>
  <div class="capture">
    <header class="bar">
      <button type="button" class="icon-btn" :aria-label="t('common.back')" @click="back"><Icon name="back" /></button>
      <h1 class="h1">{{ t('capture.title') }}</h1>
    </header>

    <input ref="input" type="file" accept="image/*" capture="environment" class="visually-hidden" tabindex="-1" aria-hidden="true" @change="onFile">

    <section class="stage">
      <button v-if="!shown" type="button" class="shoot" :disabled="preparing" @click="openCamera('front')">
        <Icon name="camera" :size="40" />
        <span class="shoot-t">{{ preparing ? t('capture.preparing') : t('capture.take') }}</span>
        <span class="shoot-h">{{ t('capture.takeHint') }}</span>
      </button>
      <template v-else>
        <img :src="shown.url" :alt="current === 'back' ? t('capture.backSide') : t('capture.front')" class="photo">
        <div class="tools">
          <button type="button" class="tool hit" :disabled="preparing" @click="rotate"><Icon name="rotate" :size="18" />{{ t('capture.rotate') }}</button>
          <button type="button" class="tool hit" :disabled="preparing" @click="openCamera(current)"><Icon name="camera" :size="18" />{{ t('capture.retake') }}</button>
          <button v-if="current === 'back'" type="button" class="tool hit" @click="removeBack"><Icon name="trash" :size="18" />{{ t('capture.removeBack') }}</button>
        </div>
      </template>
    </section>

    <div class="sides">
      <button type="button" class="side" :class="{ on: current === 'front' && sides.front }" :aria-pressed="current === 'front'"
        @click="sides.front ? (current = 'front') : openCamera('front')">
        <span class="mini"><img v-if="sides.front" :src="sides.front.url" alt=""></span>
        <span>{{ t('capture.front') }}</span>
      </button>
      <button v-if="sides.back" type="button" class="side" :class="{ on: current === 'back' }" :aria-pressed="current === 'back'" @click="current = 'back'">
        <span class="mini"><img :src="sides.back.url" alt=""></span>
        <span>{{ t('capture.backSide') }}</span>
      </button>
      <button v-else type="button" class="side add" :disabled="!sides.front || preparing" @click="openCamera('back')">
        <Icon name="plus" :size="18" />{{ t('capture.addBack') }}
      </button>
    </div>

    <p v-if="error" class="msg err" role="alert"><Icon name="alert" :size="16" />{{ error }}</p>
    <p v-else-if="note" class="msg ok" role="status"><Icon name="check" :size="16" />{{ note }}</p>

    <form class="form" @submit.prevent="save(false)">
      <label class="f"><span class="lbl">{{ t('capture.metPlace') }}</span>
        <input v-model="form.metPlace" class="inp" type="text" :placeholder="t('capture.metPlacePh')" autocomplete="off"></label>
      <label class="f"><span class="lbl">{{ t('capture.metAt') }}</span>
        <input v-model="form.metAt" class="inp" type="date"></label>
      <div class="f">
        <span class="lbl" id="cap-tags">{{ t('capture.tags') }}</span>
        <div class="tags" role="group" aria-labelledby="cap-tags">
          <button v-for="tag in tagChoices" :key="tag" type="button" class="tag hit" :class="{ on: form.tags.includes(tag) }"
            :aria-pressed="form.tags.includes(tag)" @click="toggleTag(tag)">#{{ tag }}</button>
          <input v-if="adding" ref="tagInput" v-model="newTag" class="tag-inp" :placeholder="t('capture.newTagPh')" :aria-label="t('capture.newTagPh')"
            enterkeyhint="done" @keydown.enter.prevent="commitTag" @blur="commitTag">
          <button v-else type="button" class="tag new hit" @click="startTag">{{ t('capture.newTag') }}</button>
        </div>
      </div>
      <label class="f"><span class="lbl">{{ t('capture.memo') }}</span>
        <textarea v-model="form.memo" rows="3" class="inp area" /></label>
    </form>

    <footer class="foot">
      <button type="button" class="big" :disabled="saving || preparing" @click="save(false)">{{ t('capture.saveRead') }}</button>
      <button type="button" class="next" :disabled="saving || preparing" @click="save(true)">{{ t('capture.saveNext') }}</button>
      <span class="foot-hint" :class="{ off: !status.online }">{{ status.online ? t('capture.offlineHint') : t('capture.offlineNow') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.capture { min-height: 100vh; min-height: 100dvh; padding: var(--safe-top) var(--safe-right) calc(180px + var(--safe-bottom)) var(--safe-left); }
:global(.banner-on) .capture { padding-top: 0; }
.bar { height: 56px; padding: 0 8px; display: flex; align-items: center; gap: 4px; }
.h1 { font-size: 18px; font-weight: 600; }
.icon-btn { width: 44px; height: 44px; border: 0; background: none; display: grid; place-items: center; color: var(--ink); border-radius: 10px; }
.stage {
  margin: 0 16px; border-radius: 16px; background: #1B1E24; padding: 20px 16px 14px; min-height: 230px;
  display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center;
}
.photo { max-width: 100%; max-height: 280px; border-radius: 6px; box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45); background: #fff; display: block; }
.tools { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.tool {
  height: 40px; padding: 0 14px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.35); background: rgba(255, 255, 255, 0.12);
  color: #FFFFFF; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px;
}
.shoot {
  width: 100%; min-height: 190px; border: 1.5px dashed rgba(255, 255, 255, 0.4); border-radius: 12px; background: transparent; color: #FFFFFF;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px;
}
.shoot-t { font-size: 16px; font-weight: 600; }
.shoot-h { font-size: 12px; color: rgba(255, 255, 255, 0.7); text-align: center; }
.sides { margin: 12px 16px 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.side {
  height: 64px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); display: flex; align-items: center; gap: 10px;
  padding: 0 12px; font-size: 13px; font-weight: 600; color: var(--ink); text-align: left;
}
.side.on { border: 2px solid var(--accent); padding: 0 11px; }
.side.add { border: 1.5px dashed var(--faint); background: transparent; justify-content: center; gap: 8px; font-weight: 500; color: var(--ink-2); }
.mini { width: 44px; height: 28px; flex: none; border-radius: 3px; border: 1px solid #DADDE3; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); overflow: hidden; }
.mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
.msg { margin: 12px 16px 0; display: flex; align-items: flex-start; gap: 6px; font-size: 13px; font-weight: 500; line-height: 1.45; }
.msg.err { color: var(--danger); }
.msg.ok { color: var(--ok-ink); }
.form { margin: 20px 16px 0; display: flex; flex-direction: column; gap: 16px; }
.f { display: flex; flex-direction: column; gap: 6px; }
.inp { min-height: 46px; border-radius: 12px; padding: 0 14px; }
.area { padding: 12px 14px; line-height: 1.45; resize: vertical; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; }
.tag {
  height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink-2);
  font-size: 13px; font-weight: 500;
}
.tag.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
.tag.new { border: 1px dashed var(--faint); background: transparent; }
.tag-inp { height: 36px; width: 140px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--accent); background: var(--surface); font-size: 13px; }
.foot {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  padding: 12px calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
  background: var(--surface); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px;
}
.big { height: 52px; border-radius: 14px; border: 0; background: var(--accent); color: #FFFFFF; font-size: 16px; font-weight: 600; }
.next { height: 44px; border-radius: 14px; border: 1px solid var(--line-2); background: var(--surface); color: var(--ink); font-size: 15px; font-weight: 600; }
.foot-hint { font-size: 12px; color: var(--muted); text-align: center; }
.foot-hint.off { color: var(--warn-ink); font-weight: 600; }
</style>
