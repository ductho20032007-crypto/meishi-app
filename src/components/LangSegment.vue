<script setup>
// Language segmented control: real radio inputs, labels styled as segments.
import { useI18n } from 'vue-i18n'
import { LOCALES, setLocale } from '../i18n/index.js'

defineProps({ compact: { type: Boolean, default: false } })
const { t, locale } = useI18n()
const LABELS = { ja: '日本語', vi: 'Tiếng Việt', en: 'English' }
const name = `lang-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <fieldset class="seg" :class="{ compact }">
    <legend class="visually-hidden">{{ t('settings.lang') }}</legend>
    <label v-for="l in LOCALES" :key="l" class="seg-opt" :class="{ on: locale === l }" :lang="l">
      <input class="visually-hidden" type="radio" :name="name" :value="l" :checked="locale === l" @change="setLocale(l)" />
      <span>{{ LABELS[l] }}</span>
    </label>
  </fieldset>
</template>

<style scoped>
.seg { margin: 0; border: 0; min-width: 0; display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--seg-bg); }
.seg.compact { gap: 2px; padding: 3px; }
.seg-opt {
  flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 9px; color: var(--ink-2); font-size: 14px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.compact .seg-opt { flex: none; padding: 0 10px; font-size: 13px; }
.seg-opt.on { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.seg-opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
