<script setup>
// Bottom sheet on a native <dialog showModal> (focus trap, Esc, backdrop). Mount with v-if; emits close once.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

defineProps({ title: { type: String, required: true } })
const emit = defineEmits(['close'])
const { t } = useI18n()
const dlg = ref(null)
const titleId = `sh-${Math.random().toString(36).slice(2, 8)}`
// focus goes back to whatever opened the sheet (if it is still in the page) when the sheet goes away
let opener = null
onMounted(() => {
  opener = document.activeElement
  try { dlg.value?.showModal() } catch { dlg.value?.setAttribute('open', '') }
})
onBeforeUnmount(() => {
  if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
    const el = opener
    queueMicrotask(() => { if (el.isConnected) el.focus({ preventScroll: true }) })
  }
})
let closed = false
const onClosed = () => { if (!closed) { closed = true; emit('close') } }
const close = () => { if (dlg.value?.open && typeof dlg.value.close === 'function') dlg.value.close(); else onClosed() }
// tap on the backdrop (outside the sheet box) closes
const onClick = e => { if (e.target === dlg.value) close() }
defineExpose({ close })
</script>

<template>
  <dialog ref="dlg" class="sheet" :aria-labelledby="titleId" @close="onClosed" @click="onClick">
    <div class="box">
      <header class="hd">
        <h2 :id="titleId" class="ttl">{{ title }}</h2>
        <button type="button" class="x" :aria-label="t('common.close')" @click="close"><Icon name="close" /></button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.foot" class="ft"><slot name="foot" /></footer>
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: 100%; max-width: 560px; max-height: 88dvh; margin: auto auto 0; padding: 0; border: 0; border-radius: 18px 18px 0 0;
  background: var(--bg); color: var(--ink); overflow: hidden;
}
.sheet:not([open]) { display: none; }
.sheet::backdrop { background: rgba(10, 12, 16, 0.5); }
.box { max-height: 88dvh; display: flex; flex-direction: column; }
.hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 8px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.ttl { font-size: 17px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { width: 44px; height: 44px; flex: none; border: 0; background: none; display: grid; place-items: center; border-radius: 10px; color: var(--ink); }
.body { overflow: auto; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.ft { display: flex; gap: 8px; padding: 10px 16px calc(12px + var(--safe-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
.ft :deep(.btn) { flex: 1; }
</style>
