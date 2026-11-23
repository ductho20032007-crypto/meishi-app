<script setup>
// One status notice at a time, most important first. Data always stays usable offline.
import { computed, ref, watchEffect, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { status } from '../stores/status.js'
import Icon from './Icon.vue'
import ConflictDialog from './ConflictDialog.vue'

const { t } = useI18n()
const route = useRoute()
const OCR_FATAL = { auth: 'banner.ocrAuth', region: 'banner.ocrRegion', bad_request: 'banner.ocrBadRequest' }

const notice = computed(() => {
  const e = status.error
  if (e === 'auth' || e === 'repomissing') return { id: e, tone: 'danger', icon: 'alert', text: t(`banner.${e}`), action: true }
  const o = status.ocr?.error
  if (OCR_FATAL[o]) return { id: `ocr-${o}`, tone: 'danger', icon: 'alert', text: t(OCR_FATAL[o]), action: o === 'auth' }
  if (!status.online) return { id: 'offline', tone: 'soft', icon: 'wifiOff', text: t('banner.offline') }
  if (e) return { id: e, tone: 'soft', icon: 'sync', text: t(`banner.${e === 'ratelimit' || e === 'server' || e === 'network' ? e : 'other'}`) }
  if (status.conflictCount > 0) return { id: 'conflicts', tone: 'warn', icon: 'alert', text: t('banner.conflicts', status.conflictCount) }
  return null
})
const dismissed = ref(null)
const visible = computed(() => notice.value && dismissed.value !== notice.value.id + notice.value.text)
const dismiss = () => { dismissed.value = notice.value.id + notice.value.text }
const showLink = computed(() => notice.value?.action && route.path !== '/settings')
// conflicts: tapping the banner opens the review dialog
const showConflicts = ref(false)
const isConflict = computed(() => notice.value?.id === 'conflicts')
// the banner already pads for the top safe area; pages drop theirs while it is shown (see base.css)
watchEffect(() => document.documentElement.classList.toggle('banner-on', !!visible.value))
onBeforeUnmount(() => document.documentElement.classList.remove('banner-on'))
</script>

<template>
  <div v-if="visible" class="banner" :class="notice.tone" :role="notice.tone === 'danger' ? 'alert' : 'status'">
    <Icon :name="notice.icon" :size="18" class="lead" />
    <button v-if="isConflict" type="button" class="msg msg-btn" @click="showConflicts = true">{{ notice.text }}</button>
    <p v-else class="msg">{{ notice.text }}</p>
    <button v-if="isConflict" type="button" class="act" @click="showConflicts = true">{{ t('banner.review') }}</button>
    <RouterLink v-else-if="showLink" to="/settings" class="act">{{ t('common.openSettings') }}</RouterLink>
    <button v-if="notice.tone !== 'danger'" type="button" class="x" :aria-label="t('common.dismiss')" @click="dismiss">
      <Icon name="close" :size="18" />
    </button>
  </div>
  <ConflictDialog v-if="showConflicts" @close="showConflicts = false" />
</template>

<style scoped>
.banner {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 10px;
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 10px calc(16px + var(--safe-left));
  font-size: 13px; line-height: 1.45; border-bottom: 1px solid var(--line);
}
.banner.danger { background: var(--danger-bg); color: var(--danger); border-color: var(--danger-line); }
.banner.warn { background: var(--warn-bg); color: var(--warn-ink); border-color: var(--warn-line); }
.banner.soft { background: var(--surface); color: var(--ink-2); }
.lead { align-self: flex-start; margin-top: 1px; }
.msg { flex: 1; min-width: 0; font-weight: 500; }
.msg-btn { border: 0; background: none; padding: 0; text-align: left; color: inherit; font: inherit; font-weight: 500; }
.act { flex: none; border: 0; background: none; font-size: inherit; min-height: 44px; min-width: 44px; margin: -10px 0; padding: 0 4px; display: inline-flex; align-items: center; font-weight: 600; color: inherit; text-decoration: underline; white-space: nowrap; }
.x {
  flex: none; width: 44px; height: 44px; margin: -12px -8px -12px 0;
  display: grid; place-items: center; border: 0; background: transparent; color: inherit; border-radius: 10px;
}
</style>
