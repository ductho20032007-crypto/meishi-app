<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Icon from '../components/Icon.vue'
import { hasKeys } from '../services/settings.js'
import { LOCALES, setLocale } from '../i18n/index.js'

const { t, locale } = useI18n()
const router = useRouter()
const logo = import.meta.env.BASE_URL + 'logo.svg'
const LABELS = { ja: '日本語', vi: 'Tiếng Việt', en: 'English' }
onMounted(() => { if (hasKeys()) router.replace('/') })
</script>

<template>
  <div class="page welcome">
    <div class="lang" role="radiogroup" :aria-label="t('settings.lang')">
      <button v-for="l in LOCALES" :key="l" type="button" role="radio" :aria-checked="locale === l"
        :class="{ on: locale === l }" :lang="l" @click="setLocale(l)">{{ LABELS[l] }}</button>
    </div>

    <div class="hero">
      <img class="logo" :src="logo" alt="" width="72" height="72" />
      <p class="brand">{{ t('app.name') }}</p>
      <h1>{{ t('welcome.title') }}</h1>
      <p class="body">{{ t('welcome.body') }}</p>
    </div>

    <ol class="card steps">
      <li v-for="(k, i) in ['welcome.step1', 'welcome.step2', 'welcome.step3']" :key="k">
        <span class="num" aria-hidden="true">{{ i + 1 }}</span><span>{{ t(k) }}</span>
      </li>
    </ol>

    <RouterLink to="/titles" class="card link">
      <span class="tile" aria-hidden="true"><Icon name="book" :size="20" /></span>
      <span class="txt"><span class="ttl">{{ t('welcome.titlesLink') }}</span><span class="hint">{{ t('welcome.titlesHint') }}</span></span>
      <Icon name="chevron" :size="18" class="chev" />
    </RouterLink>
  </div>
</template>

<style scoped>
.welcome { display: flex; flex-direction: column; gap: 16px; }
.lang { align-self: flex-end; margin: 0 16px; display: flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--seg-bg); }
.lang button { min-height: 44px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-2); font-size: 13px; font-weight: 500; }
.lang button.on { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.hero { padding: 24px 16px 4px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.logo { border-radius: 18px; margin-bottom: 8px; }
.brand { font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); }
.hero h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.body { font-size: 15px; line-height: 1.5; color: var(--ink-2); }
.steps { list-style: none; gap: 14px; }
.steps li { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 1.5; color: var(--ink-2); }
.num { flex: none; width: 24px; height: 24px; border-radius: 12px; background: var(--accent-soft); color: var(--accent-ink); font-size: 13px; font-weight: 700; display: grid; place-items: center; }
.link { flex-direction: row; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); min-height: 64px; }
.tile { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; flex: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ttl { font-size: 15px; font-weight: 600; }
.chev { color: var(--faint); }
</style>
