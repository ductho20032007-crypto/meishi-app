# Meishi App v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first PWA (SPA) that captures business-card photos, reads them with Gemini, stores everything in a private GitHub repo, and shows a block-style org chart, a title dictionary and a JA/VI/EN UI — deployed on GitHub Pages.

**Architecture:** Vue 3 SPA (hash router) talks to two external APIs directly from the browser: GitHub REST (data store = private repo `meishi-data`) and Gemini `generateContent` (OCR). Dexie/IndexedDB is the local source of truth + offline outbox; a sync service pushes the outbox and pulls changed files by blob SHA. All domain logic lives in pure modules under `src/lib` and `src/services` with Vitest tests; views are thin.

**Tech Stack:** Vite 8, Vue 3.5, vue-router 5, vue-i18n 11, Dexie 4, vite-plugin-pwa 2, Vitest 5 + jsdom + fake-indexeddb, `qrcode` (setup script), GitHub Actions → Pages.

**Spec:** `docs/superpowers/specs/2026-11-20-meishi-app-design.md` · **Design canvas:** https://claude.ai/artifact/MoreC7T9fd7KZKv2jHwSsa

**Secrets:** `.env.local` (gitignored) holds `MEISHI_GITHUB_TOKEN`, `MEISHI_GITHUB_REPO`, `MEISHI_GEMINI_KEY`. They are NEVER imported by app code; only `scripts/*.mjs` read them.

**Scope note:** Tasks 1–11 (logic) carry complete code + tests. UI tasks 13–17 carry the exact file list, props/behaviour and acceptance checks; their markup/CSS follows the design canvas artboards 1:1 (tokens in Task 12), and is verified with Playwright at 390×844.

---

## File structure

```
meishi-app/
  index.html
  package.json
  vite.config.js              # base '/meishi-app/', vue, pwa, vitest config
  public/logo.svg             # app icon source
  scripts/
    setup-link.mjs            # .env.local → setup URL + setup-qr.png
    ocr-smoke.mjs             # real Gemini call on tests/fixtures/cards/*
  src/
    main.js  App.vue  router.js
    i18n/index.js  i18n/ja.json  i18n/vi.json  i18n/en.json
    styles/tokens.css  styles/base.css
    data/titles.js            # title dictionary (single source)
    lib/b64.js                # utf8/base64/base64url helpers
    lib/ids.js                # id generators
    lib/rank.js               # title → rank + VI meaning
    lib/normalize.js          # company/dept/search normalisation, company matching
    lib/orgChart.js           # dept tree, boss inference, reporting chain, peers
    lib/merge.js              # 3-way field merge for sync conflicts
    lib/setupLink.js          # encode/decode setup payload
    lib/vcard.js  lib/csv.js  # exports
    lib/image.js              # resize/rotate/thumbnail (browser canvas)
    services/settings.js      # localStorage config (keys, model, lang)
    services/db.js            # Dexie schema
    services/github.js        # GitHub REST client
    services/gemini.js        # Gemini client + schema + OCR merge
    services/sync.js          # outbox push / pull / conflicts / lazy images
    services/repo.js          # app actions: create/update/delete card, companies, OCR queue
    composables/useLive.js    # Dexie liveQuery → Vue ref
    components/BottomNav.vue  Icon.vue  CardThumb.vue  Banner.vue
    views/SetupView.vue  WelcomeView.vue  ListView.vue  CaptureView.vue
    views/DetailView.vue  EditView.vue  CompaniesView.vue  OrgChartView.vue
    views/SettingsView.vue  TitlesView.vue
  tests/
    fixtures/cards/*.png
    lib/*.test.js  services/*.test.js
  .github/workflows/deploy.yml
```

---

### Task 0: Scaffold

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/App.vue`, `src/router.js`, `public/logo.svg`

- [ ] **Step 1: package.json**

```json
{
  "name": "meishi-app",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "setup-link": "node scripts/setup-link.mjs",
    "ocr-smoke": "node scripts/ocr-smoke.mjs"
  }
}
```

Run: `npm i vue@3.5.46 vue-router@5.5.1 vue-i18n@11.4.23 dexie@4.4.7` then
`npm i -D vite@8.3.8 @vitejs/plugin-vue@6.0.11 vite-plugin-pwa@2.0.0 vitest@5.1.1 jsdom@31.0.1 fake-indexeddb@6.2.8 @vue/test-utils@2.6.0 qrcode`

- [ ] **Step 2: vite.config.js**

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/meishi-app/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg'],
      manifest: {
        name: 'Meishi', short_name: 'Meishi', start_url: '/meishi-app/', scope: '/meishi-app/',
        display: 'standalone', background_color: '#F4F5F7', theme_color: '#2F5BD3',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: { navigateFallback: '/meishi-app/index.html', globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] }
    })
  ],
  test: { environment: 'jsdom', setupFiles: ['fake-indexeddb/auto'] }
})
```

- [ ] **Step 3: index.html, main.js, App.vue, router.js** (router lists every route of spec §5 plus `/setup`, `/welcome`; guard: no keys → `/welcome` except `/setup`, `/titles`).

```js
// src/router.js
import { createRouter, createWebHashHistory } from 'vue-router'
import { hasKeys } from './services/settings.js'
const routes = [
  { path: '/', component: () => import('./views/ListView.vue') },
  { path: '/capture', component: () => import('./views/CaptureView.vue') },
  { path: '/card/:id', component: () => import('./views/DetailView.vue'), props: true },
  { path: '/card/:id/edit', component: () => import('./views/EditView.vue'), props: true },
  { path: '/companies', component: () => import('./views/CompaniesView.vue') },
  { path: '/company/:id', component: () => import('./views/OrgChartView.vue'), props: r => ({ id: r.params.id, focus: r.query.focus || null }) },
  { path: '/settings', component: () => import('./views/SettingsView.vue') },
  { path: '/titles', component: () => import('./views/TitlesView.vue'), props: r => ({ q: r.query.q || '' }) },
  { path: '/setup', component: () => import('./views/SetupView.vue'), props: r => ({ c: r.query.c || '' }) },
  { path: '/welcome', component: () => import('./views/WelcomeView.vue') },
  { path: '/:p(.*)*', redirect: '/' }
]
export const router = createRouter({ history: createWebHashHistory(), routes })
const OPEN = ['/setup', '/titles', '/welcome']
router.beforeEach(to => (!hasKeys() && !OPEN.includes(to.path)) ? '/welcome' : true)
```

- [ ] **Step 4:** `npm run build` → expect success (views may be stubs `<template><div/></template>` at this point). Commit `chore: scaffold vite + vue app`.

---

### Task 1: base64 + ids

**Files:** Create `src/lib/b64.js`, `src/lib/ids.js`, Test `tests/lib/b64.test.js`, `tests/lib/ids.test.js`

- [ ] **Step 1: tests**

```js
import { describe, it, expect } from 'vitest'
import { utf8ToB64, b64ToUtf8, toB64url, fromB64url, bytesToB64, b64ToBytes } from '../../src/lib/b64.js'
describe('b64', () => {
  it('round-trips unicode', () => {
    const s = '山田 太郎 · Trưởng phòng'
    expect(b64ToUtf8(utf8ToB64(s))).toBe(s)
  })
  it('accepts GitHub base64 with newlines', () => {
    expect(b64ToUtf8(utf8ToB64('abc').replace(/(.{2})/, '$1\n'))).toBe('abc')
  })
  it('base64url has no + / =', () => {
    const u = toB64url('??>>~~')
    expect(u).not.toMatch(/[+/=]/)
    expect(fromB64url(u)).toBe('??>>~~')
  })
  it('round-trips 100 KB of bytes', () => {
    const b = new Uint8Array(100 * 1024)
    for (let i = 0; i < b.length; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536))
    expect(b64ToBytes(bytesToB64(b))).toEqual(b)
  })
})
```

```js
// tests/lib/ids.test.js
import { it, expect } from 'vitest'
import { newCardId, newCompanyId, newPlaceholderId } from '../../src/lib/ids.js'
it('formats ids', () => {
  expect(newCardId(new Date(2026, 10, 20))).toMatch(/^20261120-[a-z0-9]{6}$/)
  expect(newCompanyId()).toMatch(/^c-[a-z0-9]{8}$/)
  expect(newPlaceholderId()).toMatch(/^p-[a-z0-9]{6}$/)
})
```

- [ ] **Step 2:** `npx vitest run tests/lib/b64.test.js tests/lib/ids.test.js` → FAIL (module not found)

- [ ] **Step 3: implementation**

```js
// src/lib/b64.js
export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function b64ToUtf8(b64) { return new TextDecoder().decode(b64ToBytes(b64)) }
export function bytesToB64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function toB64url(str) { return utf8ToB64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
export function fromB64url(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  return b64ToUtf8(b + '='.repeat((4 - (b.length % 4)) % 4))
}
export async function blobToB64(blob) { return bytesToB64(new Uint8Array(await blob.arrayBuffer())) }
export function b64ToBlob(b64, type = 'image/jpeg') { return new Blob([b64ToBytes(b64)], { type }) }
```

```js
// src/lib/ids.js
const A = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function rand(n) {
  const buf = new Uint8Array(n); crypto.getRandomValues(buf)
  return Array.from(buf, b => A[b % A.length]).join('')
}
const pad = n => String(n).padStart(2, '0')
export const newCardId = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand(6)}`
export const newCompanyId = () => `c-${rand(8)}`
export const newPlaceholderId = () => `p-${rand(6)}`
```

- [ ] **Step 4:** re-run → PASS. Commit `feat: base64 and id helpers`.

---

### Task 2: Title dictionary + rank

**Files:** Create `src/data/titles.js`, `src/lib/rank.js`, Test `tests/lib/rank.test.js`

- [ ] **Step 1: test**

```js
import { describe, it, expect } from 'vitest'
import { matchTitle, rankFor, viFor } from '../../src/lib/rank.js'
import { TITLES } from '../../src/data/titles.js'
describe('matchTitle', () => {
  it.each([
    ['部長', 4, 'Trưởng phòng'],
    ['営業部長', 4, 'Trưởng phòng'],
    ['代表取締役社長', 1, 'Tổng giám đốc, người đại diện pháp luật'],
    ['課長代理', 5, 'Quyền trưởng ban / Phó ban'],
    ['取締役営業本部長', 2, 'Thành viên HĐQT'],
    ['第一営業部 課長', 5, 'Trưởng ban / Trưởng bộ phận']
  ])('%s', (t, rank, vi) => {
    const m = matchTitle(t)
    expect(m.rank).toBe(rank)
    expect(m.entry.vi).toBe(vi)
  })
  it.each([
    ['Vice President', 2], ['CEO', 1], ['Trưởng phòng Kinh doanh', 4], ['Phó tổng giám đốc', 2],
    ['Sales Manager', 5], ['Senior Manager', 4], ['Engineer', 7], ['', 7], [null, 7], ['Team Leader', 6]
  ])('fallback %s', (t, rank) => {
    expect(rankFor(t)).toBe(rank)
  })
  it.each([['Service Manager', 5], ['Chief Technology Officer', 2], ['EVP', 2], ['CTO', 2], ['CEO', 1], ['Chief Executive Officer', 1], ['Phó phòng', 4]])('fallback %s', (t, rank) => {
    expect(rankFor(t)).toBe(rank)
  })
  it('exact English / Vietnamese match returns the entry', () => {
    expect(matchTitle('Managing Director')).toMatchObject({ rank: 2, entry: { ja: '常務取締役' } })
    expect(matchTitle('Trưởng phòng')).toMatchObject({ rank: 4, entry: { ja: '部長' } })
  })
  it.each([
    ['取締役社長', 1, '社長'], ['社長室長', 4, '室長'], ['代表取締役会長', 1, '会長'], ['副社長', 2, '副社長']
  ])('JA tie-break %s', (t, rank, ja) => {
    expect(matchTitle(t)).toMatchObject({ rank, entry: { ja } })
  })
  it.each([
    ['次長兼課長', 4, '次長'], ['部長兼課長', 4, '部長'], ['社長室長兼課長', 4, '室長'],
    ['課長兼社長室長', 4, '室長'], ['会長秘書兼課長', 5, '課長'], ['副部長兼課長', 5, '課長']
  ])('concurrent post %s', (t, rank, ja) => {
    expect(matchTitle(t)).toMatchObject({ rank, entry: { ja } })
  })
  it('deputy prefix lowers rank by one', () => {
    expect(matchTitle('副部長')).toEqual({ entry: null, rank: 5 })
  })
  it('viFor', () => {
    expect(viFor('課長')).toBe('Trưởng ban / Trưởng bộ phận')
    expect(viFor('xyz')).toBeNull()
  })
  it('dictionary has 41 entries across ranks 1..7', () => {
    expect(TITLES).toHaveLength(41)
    expect(new Set(TITLES.map(t => t.rank))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation** — `src/data/titles.js` holds exactly the 41 rows of spec §5.2 (fields `rank, ja, reading, vi, en`; `ja`/`en`/`vi` may contain alternatives separated by ` / `) plus `RANK_LABELS`:

```js
export const RANK_LABELS = {
  1: { ja: '経営トップ', vi: 'Lãnh đạo cao nhất', en: 'Top executives' },
  2: { ja: '役員・取締役', vi: 'Ban điều hành / HĐQT', en: 'Board & officers' },
  3: { ja: '本部長・支店長クラス', vi: 'Giám đốc khối, chi nhánh', en: 'Division / branch heads' },
  4: { ja: '部長クラス', vi: 'Cấp phòng', en: 'Department level' },
  5: { ja: '課長クラス', vi: 'Cấp ban', en: 'Section level' },
  6: { ja: '係長・主任クラス', vi: 'Cấp nhóm', en: 'Team level' },
  7: { ja: '一般社員', vi: 'Nhân viên', en: 'Staff' }
}
export const TITLES = [
  { rank: 1, ja: '会長', reading: 'かいちょう', vi: 'Chủ tịch (HĐQT)', en: 'Chairman' },
  { rank: 1, ja: '代表取締役社長', reading: 'だいひょうとりしまりやくしゃちょう', vi: 'Tổng giám đốc, người đại diện pháp luật', en: 'President & CEO' },
  { rank: 1, ja: '社長', reading: 'しゃちょう', vi: 'Tổng giám đốc / Giám đốc', en: 'President' },
  { rank: 1, ja: '代表取締役', reading: 'だいひょうとりしまりやく', vi: 'Thành viên HĐQT đại diện pháp luật', en: 'Representative Director' },
  { rank: 1, ja: '頭取', reading: 'とうどり', vi: 'Tổng giám đốc (ngân hàng)', en: 'Bank President' },
  { rank: 1, ja: '理事長', reading: 'りじちょう', vi: 'Chủ tịch (hiệp hội, quỹ, trường)', en: 'Chairperson' },
  { rank: 2, ja: '副社長', reading: 'ふくしゃちょう', vi: 'Phó tổng giám đốc', en: 'Executive Vice President' },
  { rank: 2, ja: '専務取締役', reading: 'せんむとりしまりやく', vi: 'Giám đốc điều hành cấp cao (thành viên HĐQT)', en: 'Senior Managing Director' },
  { rank: 2, ja: '常務取締役', reading: 'じょうむとりしまりやく', vi: 'Giám đốc điều hành (thành viên HĐQT)', en: 'Managing Director' },
  { rank: 2, ja: '取締役', reading: 'とりしまりやく', vi: 'Thành viên HĐQT', en: 'Director (Board Member)' },
  { rank: 2, ja: '執行役員', reading: 'しっこうやくいん', vi: 'Giám đốc điều hành (không thuộc HĐQT)', en: 'Executive Officer' },
  { rank: 2, ja: '監査役', reading: 'かんさやく', vi: 'Kiểm soát viên', en: 'Corporate Auditor' },
  { rank: 2, ja: '相談役', reading: 'そうだんやく', vi: 'Cố vấn cấp cao', en: 'Senior Advisor' },
  { rank: 2, ja: '顧問', reading: 'こもん', vi: 'Cố vấn', en: 'Advisor' },
  { rank: 3, ja: '本部長', reading: 'ほんぶちょう', vi: 'Giám đốc khối', en: 'General Manager (Division)' },
  { rank: 3, ja: '事業部長', reading: 'じぎょうぶちょう', vi: 'Giám đốc mảng kinh doanh', en: 'Business Unit Head' },
  { rank: 3, ja: '支社長', reading: 'ししゃちょう', vi: 'Giám đốc chi nhánh (vùng)', en: 'Regional Branch Manager' },
  { rank: 3, ja: '支店長', reading: 'してんちょう', vi: 'Giám đốc chi nhánh', en: 'Branch Manager' },
  { rank: 3, ja: '工場長', reading: 'こうじょうちょう', vi: 'Giám đốc nhà máy', en: 'Plant Manager' },
  { rank: 3, ja: '所長', reading: 'しょちょう', vi: 'Giám đốc văn phòng / viện / trung tâm', en: 'Office Director' },
  { rank: 3, ja: 'センター長', reading: 'センターちょう', vi: 'Giám đốc trung tâm', en: 'Center Director' },
  { rank: 4, ja: '部長', reading: 'ぶちょう', vi: 'Trưởng phòng', en: 'Department Manager' },
  { rank: 4, ja: '担当部長', reading: 'たんとうぶちょう', vi: 'Trưởng phòng chuyên trách', en: 'Senior Manager' },
  { rank: 4, ja: '部長代理', reading: 'ぶちょうだいり', vi: 'Quyền trưởng phòng', en: 'Acting Department Manager' },
  { rank: 4, ja: '次長', reading: 'じちょう', vi: 'Phó phòng', en: 'Deputy General Manager' },
  { rank: 4, ja: '室長', reading: 'しつちょう', vi: 'Trưởng ban / Trưởng văn phòng', en: 'Office Manager' },
  { rank: 5, ja: '課長', reading: 'かちょう', vi: 'Trưởng ban / Trưởng bộ phận', en: 'Section Manager' },
  { rank: 5, ja: '課長代理', reading: 'かちょうだいり', vi: 'Quyền trưởng ban / Phó ban', en: 'Acting Section Manager' },
  { rank: 5, ja: 'マネージャー / マネジャー', reading: 'manager', vi: 'Quản lý', en: 'Manager' },
  { rank: 5, ja: 'グループリーダー', reading: 'group leader', vi: 'Trưởng nhóm (cấp ban)', en: 'Group Leader' },
  { rank: 6, ja: '係長', reading: 'かかりちょう', vi: 'Trưởng nhóm / Tổ trưởng', en: 'Team Leader / Supervisor' },
  { rank: 6, ja: '主任', reading: 'しゅにん', vi: 'Nhân viên chính / Chủ nhiệm', en: 'Chief / Senior Staff' },
  { rank: 6, ja: '主査', reading: 'しゅさ', vi: 'Chuyên viên chính', en: 'Chief Examiner / Senior Specialist' },
  { rank: 6, ja: 'チームリーダー', reading: 'team leader', vi: 'Trưởng nhóm', en: 'Team Leader' },
  { rank: 6, ja: '班長', reading: 'はんちょう', vi: 'Tổ trưởng (sản xuất)', en: 'Foreman' },
  { rank: 7, ja: '担当', reading: 'たんとう', vi: 'Nhân viên phụ trách', en: 'Staff in charge' },
  { rank: 7, ja: '社員', reading: 'しゃいん', vi: 'Nhân viên', en: 'Employee' },
  { rank: 7, ja: 'エンジニア / 技術者', reading: 'ぎじゅつしゃ', vi: 'Kỹ sư', en: 'Engineer' },
  { rank: 7, ja: '秘書', reading: 'ひしょ', vi: 'Thư ký', en: 'Secretary' },
  { rank: 7, ja: '嘱託', reading: 'しょくたく', vi: 'Nhân viên hợp đồng (thường là sau tuổi nghỉ hưu)', en: 'Contract Staff' },
  { rank: 7, ja: '派遣社員', reading: 'はけんしゃいん', vi: 'Nhân viên phái cử', en: 'Temporary Staff' }
]
```

```js
// src/lib/rank.js
import { TITLES } from '../data/titles.js'
const norm = s => (s || '').normalize('NFKC').trim().toLowerCase()
const VARIANTS = TITLES.flatMap(e => e.ja.split(' / ').map(v => ({ key: v.normalize('NFKC').replace(/\s/g, ''), entry: e })))
// exact English / Vietnamese names -> entries (first entry wins; ambiguous ranks are skipped)
const EXACT = new Map()
for (const e of TITLES) {
  for (const n of [...e.en.split(' / '), ...e.vi.split(' / ')].map(norm)) {
    if (!EXACT.has(n)) EXACT.set(n, [])
    EXACT.get(n).push(e)
  }
}
// order matters: rank 1 CEO before 2, 2 before 1 ("vice president" contains "president"), 4 before 5 ("senior manager")
const FALLBACK = [
  [1, /\bceo\b|chief executive officer/i],
  [2, /\bvice\b|phó tổng|\b(c[a-z]o|svp|evp|vp)\b(?<!ceo)|(?<!chief )executive officer|chief (?!executive).* officer/i],
  [1, /president|chairman|chủ tịch|tổng giám đốc/i],
  [3, /director|giám đốc|head of/i],
  [4, /senior manager|general manager|trưởng phòng|phó phòng/i],
  [5, /manager|trưởng ban/i],
  [6, /leader|supervisor|trưởng nhóm|tổ trưởng/i]
]
const pick = (a, b, t) => {
  if (!a) return b
  if (b.key.length !== a.key.length) return b.key.length > a.key.length ? b : a
  const sa = t.endsWith(a.key), sb = t.endsWith(b.key)
  if (sa !== sb) return sb ? b : a
  return b.entry.rank < a.entry.rank ? b : a
}
export function matchTitle(title) {
  const raw0 = (title || '').normalize('NFKC')
  if (raw0.includes('兼')) {
    // concurrent posts ("次長兼課長"): evaluate each part, the highest post wins; ties -> part with an entry, then the first
    const parts = raw0.split('兼').map(x => x.trim()).filter(Boolean)
    if (parts.length > 1) {
      return parts.map(matchOne).reduce((a, b) => {
        if (b.rank !== a.rank) return b.rank < a.rank ? b : a
        return !a.entry && b.entry ? b : a
      })
    }
  }
  return matchOne(title)
}
function matchOne(title) {
  const t = (title || '').normalize('NFKC').replace(/\s/g, '')
  if (!t) return { entry: null, rank: 7 }
  const hits = VARIANTS.filter(v => t.includes(v.key))
  if (hits.length) {
    let best
    if (hits.some(v => v.key.includes('取締役') && t.startsWith(v.key))) {
      // board-director prefix ("取締役社長", "代表取締役会長"): the highest post wins; ties -> suffix, then longest
      best = hits.reduce((a, b) => {
        if (!a) return b
        if (a.entry.rank !== b.entry.rank) return b.entry.rank < a.entry.rank ? b : a
        const sa = t.endsWith(a.key), sb = t.endsWith(b.key)
        if (sa !== sb) return sb ? b : a
        return b.key.length > a.key.length ? b : a
      }, null)
    } else {
      best = hits.reduce((a, b) => pick(a, b, t), null)
    }
    const idx = t.endsWith(best.key) ? t.length - best.key.length : t.indexOf(best.key)
    if (idx > 0 && t[idx - 1] === '副' && !best.key.startsWith('副')) {
      return { entry: null, rank: Math.min(7, best.entry.rank + 1) }
    }
    return { entry: best.entry, rank: best.entry.rank }
  }
  const ex = EXACT.get(norm(title))
  if (ex && new Set(ex.map(e => e.rank)).size === 1) return { entry: ex[0], rank: ex[0].rank }
  const raw = (title || '').normalize('NFKC')
  for (const [rank, re] of FALLBACK) if (re.test(raw)) return { entry: null, rank }
  return { entry: null, rank: 7 }
}
export const rankFor = t => matchTitle(t).rank
export const viFor = t => matchTitle(t).entry?.vi ?? null
```

- [ ] **Step 4:** run → PASS. Commit `feat: title dictionary and rank matching`.

---

### Task 3: Normalisation + company matching

**Files:** Create `src/lib/normalize.js`, Test `tests/lib/normalize.test.js`

- [ ] **Step 1: test**

```js
import { describe, it, expect } from 'vitest'
import { normalizeCompany, matchCompany, searchKey, normalizeDept } from '../../src/lib/normalize.js'
describe('normalizeCompany', () => {
  it.each([
    ['株式会社ABC商事', 'abc商事'], ['ABC商事株式会社', 'abc商事'], ['㈱ＡＢＣ商事', 'abc商事'], ['(株)ABC商事', 'abc商事'],
    ['ABC Shoji Co., Ltd.', 'abcshoji'], ['Sakura Inc.', 'sakura'], ['Công ty CP Minh Phát', 'minhphát'],
    ['Công ty TNHH Sông Hồng Tech', 'sônghồngtech'], ['Minh Phát JSC', 'minhphát'],
    ['Incredible Co., Ltd.', 'incredible'], ['Taco Ltd.', 'taco'], ['Corpus Inc.', 'corpus']
  ])('%s → %s', (a, b) => expect(normalizeCompany(a)).toBe(b))
})
describe('matchCompany', () => {
  const cs = [{ id: 'c-1', name: 'ABC商事株式会社', aliases: ['ABC Shoji Co., Ltd.'] }]
  it('matches by name and alias', () => {
    expect(matchCompany('株式会社ABC商事', cs)?.id).toBe('c-1')
    expect(matchCompany('ABC SHOJI', cs)?.id).toBe('c-1')
  })
  it('returns null for empty / unknown', () => {
    expect(matchCompany('', cs)).toBeNull()
    expect(matchCompany('XYZ', cs)).toBeNull()
  })
})
it('searchKey ignores case, width and Vietnamese accents', () => {
  expect(searchKey('Trưởng PHÒNG')).toBe(searchKey('truong phong'))
  expect(searchKey('ＡＢＣ')).toBe('abc')
})
it('normalizeDept trims and unifies width', () => expect(normalizeDept(' 第１営業部 ')).toBe('第1営業部'))
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/lib/normalize.js
const LEGAL = [
  /株式会社/g, /有限会社/g, /合同会社/g, /\(株\)/g, /\(有\)/g,
  /\bco\.?,?\s*ltd\b\.?/gi, /\bltd\b\.?/gi, /\binc\b\.?/gi, /\bcorp(oration)?\b\.?/gi, /\bjsc\b/gi, /\bllc\b/gi,
  /công ty\s+(tnhh|cổ phần|cp)(\s+(một thành viên|mtv))?/gi, /^công ty\s+/gi
]
const PUNCT = /[\s.,・·\-_'"()&]/g
export function normalizeCompany(name) {
  const plain = (name || '').normalize('NFKC').toLowerCase()
  let s = plain
  for (const re of LEGAL) s = s.replace(re, ' ')
  s = s.replace(PUNCT, '')
  return s || plain.replace(PUNCT, '')
}
export function matchCompany(raw, companies) {
  const n = normalizeCompany(raw)
  if (!n) return null
  return companies.find(c => [c.name, ...(c.aliases || [])].some(a => normalizeCompany(a) === n)) || null
}
export const normalizeDept = s => (s || '').normalize('NFKC').trim().replace(/\s+/g, '')
export function searchKey(s) {
  return (s || '').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()
}
export function cardSearchText(card, companyName = '') {
  return searchKey([card.name, card.nameKana, card.nameLatin, companyName, card.companyRaw, ...(card.deptPath || []),
    card.title, ...(card.emails || []), ...(card.tags || []), card.memo, card.metPlace].filter(Boolean).join(' '))
}
```

- [ ] **Step 4:** run → PASS. Commit `feat: company/dept/search normalisation`.

---

### Task 4: Org chart model

**Files:** Create `src/lib/orgChart.js`, Test `tests/lib/orgChart.test.js`

- [ ] **Step 1: test**

```js
import { describe, it, expect } from 'vitest'
import { buildOrg } from '../../src/lib/orgChart.js'
const P = (id, name, rank, deptPath = [], extra = {}) => ({ id, name, rank, deptPath, reportsTo: null, ...extra })
const people = () => [
  P('ito', '伊藤', 1, [], { placeholder: true }),
  P('suzuki', '鈴木', 3, ['営業本部']),
  P('tanaka', '田中', 4, ['営業本部', '第一営業部']),
  P('yamada', '山田', 5, ['営業本部', '第一営業部']),
  P('sato', '佐藤', 7, ['営業本部', '第一営業部'], { placeholder: true }),
  P('kanri', '管理', 5, ['管理本部']),
  P('ni', '二', 7, ['営業本部', '第二営業部'])
]
describe('buildOrg', () => {
  it('builds dept tree with heads and totals', () => {
    const org = buildOrg(people())
    expect(org.root.people.map(p => p.id)).toEqual(['ito'])
    const eigyo = org.root.children.find(c => c.name === '営業本部')
    expect(eigyo.head.id).toBe('suzuki')
    expect(eigyo.total).toBe(5)
    expect(eigyo.children.map(c => c.name)).toEqual(['第一営業部', '第二営業部'])
  })
  it('reporting chain top-down', () => {
    expect(buildOrg(people()).chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka', 'yamada'])
  })
  it('peers = same deepest dept, excluding self', () => {
    expect(buildOrg(people()).peers('yamada').map(p => p.id)).toEqual(['tanaka', 'sato'])
  })
  it('explicit reportsTo wins', () => {
    const ps = people(); ps.find(p => p.id === 'yamada').reportsTo = 'suzuki'
    expect(buildOrg(ps).chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'yamada'])
  })
  it('ignores reportsTo cycles for every member', () => {
    const ps = people()
    ps.find(p => p.id === 'yamada').reportsTo = 'tanaka'
    ps.find(p => p.id === 'tanaka').reportsTo = 'yamada'
    const org = buildOrg(ps)
    expect(org.chain('yamada').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka', 'yamada'])
    expect(org.chain('tanaka').map(p => p.id)).toEqual(['ito', 'suzuki', 'tanaka'])
    expect(org.bossOf('tanaka').id).toBe('suzuki')
  })
  it('ignores reportsTo pointing at a subordinate', () => {
    const ps = people(); ps.find(p => p.id === 'suzuki').reportsTo = 'yamada'
    expect(buildOrg(ps).chain('suzuki').map(p => p.id)).toEqual(['ito', 'suzuki'])
  })
  it('missing rank is 7: unknown node, never root head', () => {
    const org = buildOrg([P('u', 'U', undefined, []), P('v', 'V', 5, ['A'])])
    expect(org.nodeOf('u').unknown).toBe(true)
    expect(org.root.head).toBeNull()
  })
  it('merges dept segments that normalise equal', () => {
    const org = buildOrg([P('a', 'a', 5, ['第一営業部']), P('b', 'b', 5, ['第一営業部 ']), P('c', 'c', 5, ['ＩＴ部']), P('d', 'd', 5, ['IT部'])])
    expect(org.root.children).toHaveLength(2)
    expect(org.nodeOf('a')).toBe(org.nodeOf('b'))
    expect(org.nodeOf('c')).toBe(org.nodeOf('d'))
    expect(org.nodeOf('a').name).toBe('第一営業部')
  })
  it('unknown node head is not an inferred boss', () => {
    const org = buildOrg([P('ito', 'I', 1, []), P('u', 'U', 4, []), P('w', 'W', 6, [])])
    expect(org.nodeOf('u').unknown).toBe(true)
    expect(org.chain('w').map(p => p.id)).toEqual(['ito', 'w'])
  })
  it('segments containing / do not collide', () => {
    const org = buildOrg([P('a', 'a', 5, ['A/B']), P('b', 'b', 5, ['A', 'B'])])
    expect(org.nodeOf('a')).not.toBe(org.nodeOf('b'))
  })
  it('applies deptAliases', () => {
    const ps = [...people(), P('z', 'Z', 7, ['営業本部', '第1営業部'])]
    const org = buildOrg(ps, { '第1営業部': '第一営業部' })
    expect(org.nodeOf('z').name).toBe('第一営業部')
  })
  it('people without dept and rank>=3 go to unknown node', () => {
    const org = buildOrg([P('u', 'U', 5, [])])
    expect(org.nodeOf('u').unknown).toBe(true)
  })
  it('pathTo returns node keys from root to person node', () => {
    expect(buildOrg(people()).pathTo('yamada')).toEqual(['営業本部', '営業本部第一営業部'])
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/lib/orgChart.js
import { normalizeDept } from './normalize.js'
const SEP = '\u001f'
const rk = p => (typeof p.rank === 'number' && Number.isFinite(p.rank) ? p.rank : 7)
const byRank = (a, b) => (rk(a) - rk(b)) || (a.name || '').localeCompare(b.name || '', 'ja')
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const node = (name, key, parent, unknown = false) => ({ name, key, parent, unknown, children: [], people: [], head: null, total: 0 })

export function buildOrg(people, deptAliases = {}) {
  const alias = new Map(Object.entries(deptAliases).map(([k, v]) => [normalizeDept(k), v]))
  const root = node(null, '', null)
  const where = new Map()
  const byId = new Map(people.map(p => [p.id, p]))
  for (const p of people) {
    const path = (p.deptPath || []).map(d => alias.get(normalizeDept(d)) ?? d).filter(d => normalizeDept(d))
    let n = root
    if (!path.length && rk(p) >= 3) {
      n = root.children.find(c => c.unknown) || (root.children.push(node(null, '?', root, true)), root.children.at(-1))
    }
    for (const seg of path) {
      const nk = normalizeDept(seg)
      const key = n.key ? `${n.key}${SEP}${nk}` : nk
      let c = n.children.find(x => x.key === key)
      if (!c) { c = node(seg.trim(), key, n); n.children.push(c) }
      n = c
    }
    n.people.push(p); where.set(p.id, n)
  }
  ;(function fin(n) {
    n.people.sort(byRank); n.head = n.people[0] || null
    n.children.sort((a, b) => (a.unknown - b.unknown) || cmp(a.name || '', b.name || ''))
    n.total = n.people.length + n.children.reduce((s, c) => s + fin(c), 0)
    return n.total
  })(root)

  function inferredBoss(p) {
    const n = where.get(p.id)
    if (!n.unknown && n.head && n.head.id !== p.id && rk(n.head) < rk(p)) return n.head
    for (let a = n.parent; a; a = a.parent) if (!a.unknown && a.head && a.head.id !== p.id) return a.head
    return null
  }
  // explicit reportsTo edges that are accepted (no cycle, not pointing at a subordinate)
  const explicit = new Map()
  const bossOf = p => (explicit.has(p.id) ? byId.get(explicit.get(p.id)) : inferredBoss(p))
  const validTarget = p => (p.reportsTo && p.reportsTo !== p.id && byId.has(p.reportsTo) ? p.reportsTo : null)
  const onCycle = new Set()
  for (const p of people) {
    const seen = new Set([p.id])
    for (let t = validTarget(p); t; t = validTarget(byId.get(t))) {
      if (t === p.id) { onCycle.add(p.id); break }
      if (seen.has(t)) break
      seen.add(t)
    }
  }
  for (const p of people) {
    const t = validTarget(p)
    if (!t || onCycle.has(p.id)) continue
    let sub = false
    for (let c = byId.get(t), i = 0; c && i <= people.length; c = bossOf(c), i++) if (c.id === p.id) { sub = true; break }
    if (!sub) explicit.set(p.id, t)
  }
  function chain(id) {
    const start = byId.get(id); if (!start) return []
    const out = [start]; const seen = new Set([id])
    for (let cur = start; ;) {
      const b = bossOf(cur)
      if (!b || seen.has(b.id)) break
      out.push(b); seen.add(b.id); cur = b
    }
    return out.reverse()
  }
  const peers = id => (where.get(id)?.people || []).filter(p => p.id !== id)
  function pathTo(id) {
    const keys = []
    for (let n = where.get(id); n && n !== root; n = n.parent) keys.unshift(n.key)
    return keys
  }
  return { root, chain, peers, pathTo, nodeOf: id => where.get(id) || null, bossOf: id => (byId.get(id) ? bossOf(byId.get(id)) : null) }
}
```

- [ ] **Step 4:** run → PASS. Commit `feat: org chart model (tree, chain, peers)`.

---

### Task 5: 3-way merge, setup link, exports

**Files:** Create `src/lib/merge.js`, `src/lib/setupLink.js`, `src/lib/vcard.js`, `src/lib/csv.js`; Tests `tests/lib/merge.test.js`, `tests/lib/setupLink.test.js`, `tests/lib/export.test.js`

- [ ] **Step 1: tests**

```js
// tests/lib/merge.test.js
import { it, expect } from 'vitest'
import { merge3 } from '../../src/lib/merge.js'
const base = { id: 'a', name: 'A', memo: '', tags: [], updatedAt: '1' }
it('takes non-overlapping changes from both sides', () => {
  const r = merge3(base, { ...base, memo: 'local', updatedAt: '2' }, { ...base, tags: ['x'], updatedAt: '3' })
  expect(r.conflicts).toEqual([])
  expect(r.merged).toMatchObject({ memo: 'local', tags: ['x'], updatedAt: '3' })
})
it('reports same-field conflicts', () => {
  const r = merge3(base, { ...base, name: 'L' }, { ...base, name: 'R' })
  expect(r.conflicts).toEqual(['name'])
})
it('no base: identical fields fine, differing fields conflict', () => {
  expect(merge3(null, { a: 1, b: 2 }, { a: 1, b: 3 }).conflicts).toEqual(['b'])
})
it('unions tags when both sides changed', () => {
  const r = merge3(base, { ...base, tags: ['a', 'b'] }, { ...base, tags: ['b', 'c'] })
  expect(r.conflicts).toEqual([])
  expect(r.merged.tags).toEqual(['a', 'b', 'c'])
})
it('tags union respects deletions relative to base', () => {
  const r = merge3({ ...base, tags: ['a'] }, { ...base, tags: ['b'] }, { ...base, tags: ['a', 'c'] })
  expect(r.conflicts).toEqual([])
  expect(r.merged.tags).toEqual(['b', 'c'])
})
```

```js
// tests/lib/setupLink.test.js
import { it, expect } from 'vitest'
import { encodeSetup, decodeSetup, buildSetupUrl } from '../../src/lib/setupLink.js'
const cfg = { gh: 'github_pat_abc', repo: 'me/meishi-data', gk: 'AQ.xyz' }
it('round-trips', () => expect(decodeSetup(encodeSetup(cfg))).toEqual(cfg))
it('rejects garbage', () => {
  expect(() => decodeSetup('!!!')).toThrow()
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: 'bad' }))).toThrow()
})
it('builds hash url', () => {
  expect(buildSetupUrl('https://x.github.io/meishi-app/', cfg)).toMatch(/^https:\/\/x\.github\.io\/meishi-app\/#\/setup\?c=[\w-]+$/)
})
it('trims values', () => {
  expect(decodeSetup(encodeSetup({ gh: 'github_pat_abc\r', repo: ' me/meishi-data\n', gk: 'AQ.xyz ' }))).toEqual(cfg)
})
it('rejects path-like repo', () => {
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: '../x' }))).toThrow()
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: 'me/..' }))).toThrow()
})
```

```js
// tests/lib/export.test.js
import { it, expect } from 'vitest'
import { toVCard } from '../../src/lib/vcard.js'
import { toCsv } from '../../src/lib/csv.js'
const card = { id: '1', name: '山田 太郎', nameKana: 'やまだ たろう', title: '課長', deptPath: ['営業本部', '第一営業部'],
  phones: [{ type: 'mobile', value: '090-1' }, { type: 'office', value: '03-2' }], emails: ['a@b.jp'], address: '東京, 千代田', website: '', memo: 'm;x', tags: ['k'] }
it('vcard', () => {
  const v = toVCard(card, 'ABC商事')
  expect(v).toContain('BEGIN:VCARD\r\nVERSION:3.0')
  expect(v).toContain('FN:山田 太郎')
  expect(v).toContain('ORG:ABC商事;営業本部;第一営業部')
  expect(v).toContain('N:山田;太郎;;;')
  expect(v).toContain('X-PHONETIC-LAST-NAME:やまだ')
  expect(v).toContain('X-PHONETIC-FIRST-NAME:たろう')
  expect(v).toContain('TEL;TYPE=CELL:090-1')
  expect(v).toContain('TEL;TYPE=WORK:03-2')
  expect(v).toContain('ADR;TYPE=WORK:;;東京\\, 千代田;;;;')
  expect(v).toContain('NOTE:m\\;x')
  expect(v.endsWith('END:VCARD\r\n')).toBe(true)
})
it('vcard: fax type, no-space name, no line injection', () => {
  const v = toVCard({ ...card, name: '山田', nameKana: 'やまだ', phones: [{ type: 'fax', value: '03-9' }, { type: 'office', value: '1\nEND:VCARD\nFN:x' }], memo: 'a\r\nb' }, 'X')
  expect(v).toContain('TEL;TYPE=WORK,FAX:03-9')
  expect(v).toContain('N:山田;;;;')
  expect(v).toContain('X-PHONETIC-LAST-NAME:やまだ')
  expect(v).not.toContain('X-PHONETIC-FIRST-NAME')
  expect(v).toContain('NOTE:a\\nb')
  expect(v.split('\r\n').filter(l => l === 'END:VCARD')).toHaveLength(1)
  expect(v.split('\r\n')).not.toContain('FN:x')
})
it('csv with BOM and quoting', () => {
  const c = toCsv([card], () => 'ABC "商事"')
  expect(c.startsWith('﻿')).toBe(true)
  expect(c).toContain('"ABC ""商事"""')
})
it('csv neutralises formulas and falls back to companyRaw', () => {
  const c = toCsv([{ ...card, name: '=HYPERLINK(1)', nameKana: '+1', nameLatin: '@SUM(1)', companyRaw: 'Raw Co' }], () => '')
  expect(c).toContain('"\'=HYPERLINK(1)"')
  expect(c).toContain('"\'+1"')
  expect(c).toContain('"\'@SUM(1)"')
  expect(c).toContain('"Raw Co"')
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/lib/merge.js
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export function merge3(base, local, remote) {
  const merged = {}; const conflicts = []
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])
  for (const k of keys) {
    const l = local?.[k], r = remote?.[k], b = base?.[k]
    if (k === 'updatedAt') { merged[k] = [l, r].filter(Boolean).sort().at(-1); continue }
    if (eq(l, r)) merged[k] = l
    else if (base && eq(l, b)) merged[k] = r
    else if (base && eq(r, b)) merged[k] = l
    else if (k === 'tags' && Array.isArray(l) && Array.isArray(r)) {
      const u = [...l, ...r.filter(x => !l.includes(x))]
      const bt = Array.isArray(b) ? b : null
      merged[k] = bt ? u.filter(x => !(bt.includes(x) && (!l.includes(x) || !r.includes(x)))) : u
    }
    else { conflicts.push(k); merged[k] = l }
  }
  return { merged, conflicts }
}
```

```js
// src/lib/setupLink.js
import { toB64url, fromB64url } from './b64.js'
export function encodeSetup({ gh, repo, gk }) { return toB64url(JSON.stringify({ v: 1, gh: gh.trim(), repo: repo.trim(), gk: gk.trim() })) }
export function decodeSetup(c) {
  let o
  try { o = JSON.parse(fromB64url(c)) } catch { throw new Error('invalid_setup') }
  if (o?.v !== 1 || typeof o.gh !== 'string' || typeof o.gk !== 'string' || typeof o.repo !== 'string') throw new Error('invalid_setup')
  const gh = o.gh.trim(), repo = o.repo.trim(), gk = o.gk.trim()
  if (!gh || !gk || !/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(repo)) throw new Error('invalid_setup')
  return { gh, repo, gk }
}
export const buildSetupUrl = (base, cfg) => `${base.replace(/\/?$/, '/')}#/setup?c=${encodeSetup(cfg)}`
```

```js
// src/lib/vcard.js
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1')
const raw = s => String(s ?? '').replace(/[\r\n]+/g, '')
const TEL = { mobile: 'CELL', office: 'WORK', fax: 'WORK,FAX' }
const splitName = s => {
  const t = String(s ?? '').trim()
  const i = t.search(/[ \u3000]/)
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1).trim()]
}
export function toVCard(card, companyName = '') {
  const [fam, giv] = splitName(card.name)
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(card.name)}`, `N:${esc(fam)};${esc(giv)};;;`]
  if (card.nameKana) {
    const [kf, kg] = splitName(card.nameKana)
    L.push(`X-PHONETIC-LAST-NAME:${esc(kf)}`)
    if (kg) L.push(`X-PHONETIC-FIRST-NAME:${esc(kg)}`)
  }
  if (companyName || card.deptPath?.length) L.push(['ORG:' + esc(companyName), ...(card.deptPath || []).map(esc)].join(';'))
  if (card.title) L.push(`TITLE:${esc(card.title)}`)
  for (const p of card.phones || []) L.push(`TEL;TYPE=${TEL[p.type] || 'VOICE'}:${raw(p.value)}`)
  for (const e of card.emails || []) L.push(`EMAIL;TYPE=INTERNET:${raw(e)}`)
  if (card.address) L.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`)
  if (card.website) L.push(`URL:${raw(card.website)}`)
  if (card.memo) L.push(`NOTE:${esc(card.memo)}`)
  L.push('END:VCARD')
  return L.join('\r\n') + '\r\n'
}
export const toVCards = (cards, companyNameOf) => cards.map(c => toVCard(c, companyNameOf(c))).join('')
```

```js
// src/lib/csv.js
const COLS = ['name', 'nameKana', 'nameLatin', 'company', 'dept', 'title', 'rank', 'phones', 'emails', 'address', 'website', 'tags', 'metAt', 'metPlace', 'memo']
// neutralise spreadsheet formula injection, then quote
const q = v => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}
export function toCsv(cards, companyNameOf = () => '') {
  const rows = cards.map(c => [c.name, c.nameKana, c.nameLatin, companyNameOf(c) || c.companyRaw || '', (c.deptPath || []).join(' / '),
    c.title, c.rank, (c.phones || []).map(p => `${p.type}:${p.value}`).join(' | '), (c.emails || []).join(' | '), c.address,
    c.website, (c.tags || []).join(' | '), c.metAt, c.metPlace, c.memo].map(q).join(','))
  return '\uFEFF' + [COLS.join(','), ...rows].join('\r\n') + '\r\n'
}
```

Note: `toCsv` second arg is keyed by **card id** → company name (caller builds it).

- [ ] **Step 4:** run → PASS. Commit `feat: merge, setup link, vcard/csv export`.

---

### Task 6: Settings + DB

**Files:** Create `src/services/settings.js`, `src/services/db.js`; Test `tests/services/settings.test.js`

- [ ] **Step 1: test**

```js
import { it, expect, beforeEach } from 'vitest'
import { getConfig, saveKeys, clearKeys, hasKeys, setPref } from '../../src/services/settings.js'
beforeEach(() => localStorage.clear())
it('stores and clears keys', () => {
  expect(hasKeys()).toBe(false)
  saveKeys({ gh: 't', repo: 'me/d', gk: 'k' })
  expect(hasKeys()).toBe(true)
  expect(getConfig()).toMatchObject({ gh: 't', repo: 'me/d', gk: 'k', model: 'gemini-flash-latest' })
  setPref('model', 'gemini-3.5-flash'); expect(getConfig().model).toBe('gemini-3.5-flash')
  clearKeys(); expect(hasKeys()).toBe(false); expect(getConfig().model).toBe('gemini-3.5-flash')
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/services/settings.js
const K = { gh: 'meishi.gh', repo: 'meishi.repo', gk: 'meishi.gk', model: 'meishi.model', lang: 'meishi.lang' }
const get = k => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }
export const DEFAULT_MODEL = 'gemini-flash-latest'
export function getConfig() {
  return { gh: get(K.gh), repo: get(K.repo), gk: get(K.gk), model: get(K.model) || DEFAULT_MODEL, lang: get(K.lang) }
}
export const hasKeys = () => !!(get(K.gh) && get(K.repo) && get(K.gk))
export function saveKeys({ gh, repo, gk }) { set(K.gh, gh); set(K.repo, repo); set(K.gk, gk) }
export function clearKeys() { set(K.gh, null); set(K.repo, null); set(K.gk, null) }
export function setPref(name, value) { set(K[name], value) }
```

```js
// src/services/db.js
import Dexie from 'dexie'
export function openDb(name = 'meishi') {
  const db = new Dexie(name)
  db.version(1).stores({
    cards: 'id, companyId, status, updatedAt',
    companies: 'id',
    images: 'path',              // { path, blob }
    files: 'path',               // { path, sha, base }  last synced state
    outbox: '++seq, &path',      // { seq, path, op: 'put'|'delete', state: 'ready'|'conflict' }
    conflicts: 'path',           // { path, local, remote, remoteSha, fields }
    meta: 'key'                  // { key, value }
  })
  return db
}
export const db = openDb()
```

- [ ] **Step 4:** run → PASS. Commit `feat: settings and dexie schema`.

---

### Task 7: GitHub client

**Files:** Create `src/services/github.js`; Test `tests/services/github.test.js`

- [ ] **Step 1: test** (fetch mock records calls)

```js
import { describe, it, expect, vi } from 'vitest'
import { createGitHub, GitHubError } from '../../src/services/github.js'
const res = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers })
describe('github client', () => {
  it('lists tree blobs', async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { tree: [{ path: 'cards/a.json', type: 'blob', sha: 's1' }, { path: 'cards', type: 'tree', sha: 't' }] }))
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch })
    expect(await gh.getTree()).toEqual([{ path: 'cards/a.json', sha: 's1' }])
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/me/d/git/trees/HEAD?recursive=1')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })
  it('puts file with sha and returns new sha', async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { content: { sha: 'new' } }))
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch })
    expect(await gh.putFile('cards/a.json', 'Zm9v', 'old')).toBe('new')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/me/d/contents/cards/a.json')
    expect(JSON.parse(init.body)).toMatchObject({ content: 'Zm9v', sha: 'old' })
  })
  it.each([[401, 'auth'], [404, 'notfound'], [409, 'conflict'], [422, 'conflict']])('maps %i → %s', async (s, kind) => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(s, { message: 'x' })) })
    await expect(gh.getTree()).rejects.toMatchObject({ kind })
  })
  it('detects rate limit', async () => {
    const fetch = vi.fn().mockResolvedValue(res(403, { message: 'rate' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }))
    await expect(createGitHub({ token: 't', repo: 'me/d', fetch }).getTree()).rejects.toMatchObject({ kind: 'ratelimit', resetAt: 1800000000000 })
  })
  it('network failure → network', async () => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockRejectedValue(new TypeError('Failed')) })
    await expect(gh.getTree()).rejects.toBeInstanceOf(GitHubError)
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/services/github.js
export class GitHubError extends Error {
  constructor(kind, status, message, resetAt = null) { super(message); this.kind = kind; this.status = status; this.resetAt = resetAt }
}
export function createGitHub({ token, repo, fetch = globalThis.fetch.bind(globalThis) }) {
  const base = `https://api.github.com/repos/${repo}`
  async function call(path, init = {}) {
    let r
    try {
      r = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
    } catch (e) { throw new GitHubError('network', 0, e.message) }
    if (r.ok) return r.status === 204 ? null : r.json()
    const body = await r.json().catch(() => ({}))
    const msg = body.message || r.statusText
    if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0')
      throw new GitHubError('ratelimit', r.status, msg, Number(r.headers.get('x-ratelimit-reset')) * 1000)
    const kind = { 401: 'auth', 403: 'auth', 404: 'notfound', 409: 'conflict', 422: 'conflict' }[r.status] || 'other'
    throw new GitHubError(kind, r.status, msg)
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/')
  return {
    ping: () => call(''),
    async getTree() {
      const t = await call('/git/trees/HEAD?recursive=1')
      return t.tree.filter(e => e.type === 'blob').map(({ path, sha }) => ({ path, sha }))
    },
    async getBlob(sha) { return (await call(`/git/blobs/${sha}`)).content },          // base64
    async getFile(path) { const f = await call(`/contents/${enc(path)}`); return { sha: f.sha, content: f.content } },
    async putFile(path, contentB64, sha, message = `update ${path}`) {
      const r = await call(`/contents/${enc(path)}`, { method: 'PUT', body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }) })
      return r.content.sha
    },
    async deleteFile(path, sha, message = `delete ${path}`) {
      await call(`/contents/${enc(path)}`, { method: 'DELETE', body: JSON.stringify({ message, sha }) })
    }
  }
}
```

- [ ] **Step 4:** run → PASS. Commit `feat: github rest client`.

---

### Task 8: Sync engine

**Files:** Create `src/services/sync.js`; Test `tests/services/sync.test.js` (in-memory fake GitHub + fake-indexeddb)

- [ ] **Step 1: test**

```js
// @vitest-environment node   (native Blob/arrayBuffer; fake-indexeddb still loaded via setupFiles)
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/services/db.js'
import { createSync } from '../../src/services/sync.js'
import { GitHubError } from '../../src/services/github.js'
import { utf8ToB64, b64ToUtf8 } from '../../src/lib/b64.js'

function fakeGh() {
  const files = new Map(); let n = 0
  return {
    files,
    async getTree() { return [...files].map(([path, f]) => ({ path, sha: f.sha })) },
    async getBlob(sha) { return [...files.values()].find(f => f.sha === sha).content },
    async getFile(path) { const f = files.get(path); if (!f) throw new GitHubError('notfound', 404, ''); return f },
    async putFile(path, content, sha) {
      const cur = files.get(path)
      if ((cur && cur.sha !== sha) || (!cur && sha)) throw new GitHubError('conflict', 409, 'sha')
      const s = `s${++n}`; files.set(path, { sha: s, content }); return s
    },
    async deleteFile(path, sha) { if (files.get(path)?.sha !== sha) throw new GitHubError('conflict', 409, ''); files.delete(path) }
  }
}
const remoteJson = (gh, path) => JSON.parse(b64ToUtf8(gh.files.get(path).content))
let db, gh, sync, i = 0
beforeEach(() => { db = openDb(`t${++i}`); gh = fakeGh(); sync = createSync({ db, gh }) })

describe('sync', () => {
  it('pushes a new card then pulls nothing new', async () => {
    await db.cards.put({ id: 'a', name: 'A', updatedAt: '1' })
    await sync.enqueue('cards/a.json')
    await sync.push()
    expect(remoteJson(gh, 'cards/a.json').name).toBe('A')
    expect(await db.outbox.count()).toBe(0)
    expect(await sync.pull()).toEqual({ updated: 0, deleted: 0 })
  })
  it('pulls remote changes and deletions', async () => {
    gh.files.set('cards/b.json', { sha: 'x1', content: utf8ToB64(JSON.stringify({ id: 'b', name: 'B' })) })
    gh.files.set('companies/c-1.json', { sha: 'x2', content: utf8ToB64(JSON.stringify({ id: 'c-1', name: 'C' })) })
    expect(await sync.pull()).toEqual({ updated: 2, deleted: 0 })
    expect((await db.cards.get('b')).name).toBe('B')
    gh.files.delete('cards/b.json')
    expect(await sync.pull()).toEqual({ updated: 0, deleted: 1 })
    expect(await db.cards.get('b')).toBeUndefined()
  })
  it('does not overwrite local pending edits on pull', async () => {
    gh.files.set('cards/b.json', { sha: 'x1', content: utf8ToB64(JSON.stringify({ id: 'b', name: 'remote' })) })
    await db.cards.put({ id: 'b', name: 'local' }); await sync.enqueue('cards/b.json')
    await sync.pull()
    expect((await db.cards.get('b')).name).toBe('local')
  })
  it('auto-merges non-overlapping conflict', async () => {
    gh.files.set('cards/a.json', { sha: 'x1', content: utf8ToB64(JSON.stringify({ id: 'a', name: 'A', memo: '' })) })
    await sync.pull()
    gh.files.set('cards/a.json', { sha: 'x9', content: utf8ToB64(JSON.stringify({ id: 'a', name: 'A2', memo: '' })) })
    await db.cards.update('a', { memo: 'mine' }); await sync.enqueue('cards/a.json')
    await sync.push()
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ name: 'A2', memo: 'mine' })
    expect(await db.conflicts.count()).toBe(0)
  })
  it('records same-field conflict and resolves keep-remote', async () => {
    gh.files.set('cards/a.json', { sha: 'x1', content: utf8ToB64(JSON.stringify({ id: 'a', name: 'A' })) })
    await sync.pull()
    gh.files.set('cards/a.json', { sha: 'x9', content: utf8ToB64(JSON.stringify({ id: 'a', name: 'R' })) })
    await db.cards.update('a', { name: 'L' }); await sync.enqueue('cards/a.json')
    await sync.push()
    expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['name'])
    await sync.resolve('cards/a.json', 'remote')
    expect((await db.cards.get('a')).name).toBe('R')
    expect(await db.outbox.count()).toBe(0)
  })
  it('pushes images from images table and deletes', async () => {
    await db.images.put({ path: 'images/a-front.jpg', blob: new Blob([new Uint8Array([1, 2, 3])]) })
    await sync.enqueue('images/a-front.jpg'); await sync.push()
    expect(gh.files.get('images/a-front.jpg').content).toBe('AQID')
    await db.images.delete('images/a-front.jpg'); await sync.enqueue('images/a-front.jpg', 'delete'); await sync.push()
    expect(gh.files.has('images/a-front.jpg')).toBe(false)
  })
  it('lazily downloads image blobs', async () => {
    gh.files.set('images/z-front.jpg', { sha: 'i1', content: 'AQID' })
    await sync.pull()
    const blob = await sync.getImage('images/z-front.jpg')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/services/sync.js
import { utf8ToB64, b64ToUtf8, blobToB64, b64ToBlob } from '../lib/b64.js'
import { merge3 } from '../lib/merge.js'

const tableOf = path => path.startsWith('cards/') ? 'cards' : path.startsWith('companies/') ? 'companies' : null
const idOf = path => path.split('/').pop().replace(/\.json$/, '')

export function createSync({ db, gh }) {
  async function localContent(path) {
    const t = tableOf(path)
    if (t) { const rec = await db[t].get(idOf(path)); return rec ? { b64: utf8ToB64(JSON.stringify(rec, null, 2)), rec } : null }
    const img = await db.images.get(path)
    return img ? { b64: await blobToB64(img.blob) } : null
  }
  async function enqueue(path, op = 'put') {
    await db.transaction('rw', db.outbox, async () => {
      await db.outbox.where('path').equals(path).delete()
      await db.outbox.add({ path, op, state: 'ready' })
    })
  }
  async function pushOne(item) {
    const known = await db.files.get(item.path)
    if (item.op === 'delete') {
      if (known?.sha) await gh.deleteFile(item.path, known.sha)
      await db.files.delete(item.path)
      return
    }
    const c = await localContent(item.path)
    if (!c) { await db.outbox.delete(item.seq); return }
    const sha = await gh.putFile(item.path, c.b64, known?.sha)
    await db.files.put({ path: item.path, sha, base: c.rec ?? null })
  }
  async function handleConflict(item) {
    const remote = await gh.getFile(item.path)
    const t = tableOf(item.path)
    if (!t) { await db.files.put({ path: item.path, sha: remote.sha, base: null }); return pushOne(item) }   // images: local wins
    const remoteRec = JSON.parse(b64ToUtf8(remote.content))
    const localRec = await db[t].get(idOf(item.path))
    const { merged, conflicts } = merge3((await db.files.get(item.path))?.base ?? null, localRec, remoteRec)
    if (conflicts.length) {
      await db.conflicts.put({ path: item.path, local: localRec, remote: remoteRec, remoteSha: remote.sha, fields: conflicts })
      await db.outbox.update(item.seq, { state: 'conflict' })
      return 'conflict'
    }
    await db[t].put(merged)
    await db.files.put({ path: item.path, sha: remote.sha, base: remoteRec })
    return pushOne(item)
  }
  async function push() {
    const items = await db.outbox.orderBy('seq').filter(i => i.state === 'ready').toArray()
    for (const item of items) {
      try { await pushOne(item) }
      catch (e) {
        if (e.kind !== 'conflict') throw e
        if ((await handleConflict(item)) === 'conflict') continue
      }
      await db.outbox.delete(item.seq)
    }
  }
  async function pull() {
    const tree = await gh.getTree()
    const remote = new Map(tree.map(e => [e.path, e.sha]))
    const pending = new Set((await db.outbox.toArray()).map(o => o.path))
    let updated = 0, deleted = 0
    for (const [path, sha] of remote) {
      if (pending.has(path)) continue
      const known = await db.files.get(path)
      if (known?.sha === sha) continue
      const t = tableOf(path)
      if (t) {
        const rec = JSON.parse(b64ToUtf8(await gh.getBlob(sha)))
        await db[t].put(rec); await db.files.put({ path, sha, base: rec }); updated++
      } else if (path.startsWith('images/')) {
        await db.images.delete(path); await db.files.put({ path, sha, base: null })
      }
    }
    for (const f of await db.files.toArray()) {
      if (remote.has(f.path) || pending.has(f.path)) continue
      const t = tableOf(f.path)
      if (t) { await db[t].delete(idOf(f.path)); deleted++ } else await db.images.delete(f.path)
      await db.files.delete(f.path)
    }
    return { updated, deleted }
  }
  async function resolve(path, keep) {
    const c = await db.conflicts.get(path); if (!c) return
    const t = tableOf(path)
    await db.files.put({ path, sha: c.remoteSha, base: c.remote })
    if (keep === 'remote') {
      await db[t].put(c.remote)
      await db.outbox.where('path').equals(path).delete()
    } else {
      await db.outbox.where('path').equals(path).modify({ state: 'ready' })
    }
    await db.conflicts.delete(path)
    if (keep !== 'remote') await push()
  }
  async function getImage(path) {
    const hit = await db.images.get(path); if (hit) return hit.blob
    const f = await db.files.get(path); if (!f) return null
    const blob = b64ToBlob(await gh.getBlob(f.sha))
    await db.images.put({ path, blob })
    return blob
  }
  return { enqueue, push, pull, resolve, getImage, async syncAll() { await push(); return pull() } }
}
```

- [ ] **Step 4:** run → PASS. Commit `feat: sync engine with outbox, pull, 3-way conflict handling`.

---

### Task 9: Gemini client

**Files:** Create `src/services/gemini.js`; Test `tests/services/gemini.test.js`

- [ ] **Step 1: test**

```js
import { describe, it, expect, vi } from 'vitest'
import { createGemini, mergeOcr, sanitizeOcr } from '../../src/services/gemini.js'
const ok = obj => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 })
describe('gemini', () => {
  it('sends images + schema and parses JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ name: '山田 太郎', title: '課長', deptPath: ['営業本部'], rank: 5 }))
    const g = createGemini({ key: 'K', model: 'gemini-flash-latest', fetch })
    const r = await g.extract([{ mimeType: 'image/jpeg', data: 'AAA' }])
    expect(r.name).toBe('山田 太郎')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('K')
    const body = JSON.parse(init.body)
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAA' } })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
  it.each([[429, 'quota'], [400, 'auth'], [403, 'auth'], [500, 'other']])('maps %i → %s', async (s, kind) => {
    const g = createGemini({ key: 'K', fetch: vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: s })) })
    await expect(g.extract([])).rejects.toMatchObject({ kind })
  })
  it('sanitizes and fills rank from title', () => {
    const s = sanitizeOcr({ name: ' A ', title: '部長', rank: 99, phones: [{ type: 'mobile', value: '1' }, { value: '' }], emails: 'x' })
    expect(s).toMatchObject({ name: 'A', rank: 4, phones: [{ type: 'mobile', value: '1' }], emails: [], deptPath: [] })
  })
  it('mergeOcr keeps user-entered fields', () => {
    const card = { id: '1', name: '', memo: 'm', tags: ['t'], phones: [], status: 'pending' }
    const m = mergeOcr(card, { name: 'N', phones: [{ type: 'mobile', value: '1' }], memo: 'ignored' })
    expect(m).toMatchObject({ name: 'N', memo: 'm', tags: ['t'], status: 'done', ocrBy: 'gemini', ocrError: null })
  })
})
```

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: implementation**

```js
// src/services/gemini.js
import { rankFor } from '../lib/rank.js'
export class GeminiError extends Error { constructor(kind, status, message) { super(message); this.kind = kind; this.status = status } }
const STR = { type: 'STRING' }
export const OCR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: STR, nameKana: STR, nameLatin: STR, companyRaw: STR,
    deptPath: { type: 'ARRAY', items: STR }, title: STR, rank: { type: 'INTEGER' },
    phones: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING', enum: ['mobile', 'office', 'fax'] }, value: STR }, required: ['type', 'value'] } },
    emails: { type: 'ARRAY', items: STR }, address: STR, website: STR
  },
  required: ['name', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails']
}
export const OCR_PROMPT = `You read a business card photo (front, optional back) and return JSON only.
Rules:
- Keep text in the original script (Japanese/Vietnamese/English). Do not translate.
- name: person's full name as printed. nameKana: hiragana reading if furigana printed or confidently inferable, else "". nameLatin: romanized name if printed, else "".
- companyRaw: company name exactly as printed.
- deptPath: department split from top level to lowest, e.g. "営業本部 第一営業部 1課" → ["営業本部","第一営業部","1課"]. Do NOT include the job title.
- title: job title only (e.g. "課長"), without department.
- rank: 1 chairman/president/CEO; 2 board/officers/VP/vice president; 3 division/branch head, director; 4 department head (部長, trưởng phòng); 5 section head (課長, manager); 6 team lead (係長, 主任); 7 staff/none.
- phones: type mobile for 携帯/mobile/di động or numbers starting 070/080/090; fax for FAX; otherwise office.
- Unknown fields: "" or [].`

export function createGemini({ key, model = 'gemini-flash-latest', fetch = globalThis.fetch.bind(globalThis) }) {
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  async function call(url, init) {
    let r
    try { r = await fetch(url, { ...init, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' } }) }
    catch (e) { throw new GeminiError('network', 0, e.message) }
    if (r.ok) return r.json()
    const msg = (await r.json().catch(() => ({})))?.error?.message || r.statusText
    const kind = r.status === 429 ? 'quota' : [400, 401, 403].includes(r.status) ? 'auth' : 'other'
    throw new GeminiError(kind, r.status, msg)
  }
  return {
    ping: () => call(`${base}/models?pageSize=1`, { method: 'GET' }),
    async extract(images) {
      const body = {
        contents: [{ role: 'user', parts: [{ text: OCR_PROMPT }, ...images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: OCR_SCHEMA, temperature: 0 }
      }
      const j = await call(`${base}/models/${model}:generateContent`, { method: 'POST', body: JSON.stringify(body) })
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')
      try { return sanitizeOcr(JSON.parse(text)) } catch { throw new GeminiError('bad_response', 200, 'unparseable response') }
    }
  }
}
const s = v => (typeof v === 'string' ? v.trim() : '')
const arr = v => (Array.isArray(v) ? v : [])
export function sanitizeOcr(o) {
  const title = s(o.title)
  const rank = Number.isInteger(o.rank) && o.rank >= 1 && o.rank <= 7 ? o.rank : rankFor(title)
  return {
    name: s(o.name), nameKana: s(o.nameKana), nameLatin: s(o.nameLatin), companyRaw: s(o.companyRaw),
    deptPath: arr(o.deptPath).map(s).filter(Boolean), title, rank,
    phones: arr(o.phones).map(p => ({ type: ['mobile', 'office', 'fax'].includes(p?.type) ? p.type : 'office', value: s(p?.value) })).filter(p => p.value),
    emails: arr(o.emails).map(s).filter(Boolean), address: s(o.address), website: s(o.website)
  }
}
const OCR_FIELDS = ['name', 'nameKana', 'nameLatin', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails', 'address', 'website']
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)
export function mergeOcr(card, ocr) {
  const out = { ...card }
  for (const f of OCR_FIELDS) if (empty(card[f]) && !empty(ocr[f])) out[f] = ocr[f]
  return { ...out, status: 'done', ocrBy: 'gemini', ocrError: null }
}
```

- [ ] **Step 4:** run → PASS. Commit `feat: gemini OCR client`.

---

### Task 10: Scripts — setup link + OCR smoke test (real keys)

**Files:** Create `scripts/env.mjs`, `scripts/setup-link.mjs`, `scripts/ocr-smoke.mjs`, fixtures `tests/fixtures/cards/{ja-yamada,vi-nguyen,en-smith}.png`

- [ ] **Step 1: env loader**

```js
// scripts/env.mjs
import { readFileSync } from 'node:fs'
export function loadEnv(file = new URL('../.env.local', import.meta.url)) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
  }
  for (const k of ['MEISHI_GITHUB_TOKEN', 'MEISHI_GITHUB_REPO', 'MEISHI_GEMINI_KEY']) if (!env[k]) throw new Error(`${k} missing in .env.local`)
  return env
}
```

- [ ] **Step 2: setup-link.mjs**

```js
import QRCode from 'qrcode'
import { loadEnv } from './env.mjs'
import { buildSetupUrl } from '../src/lib/setupLink.js'
const env = loadEnv()
const base = process.argv[2] || `https://${env.MEISHI_GITHUB_REPO.split('/')[0]}.github.io/meishi-app/`
const url = buildSetupUrl(base, { gh: env.MEISHI_GITHUB_TOKEN, repo: env.MEISHI_GITHUB_REPO, gk: env.MEISHI_GEMINI_KEY })
await QRCode.toFile(new URL('../setup-qr.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), url, { width: 600, margin: 2 })
console.log('Setup QR saved to setup-qr.png (contains secrets — do not share).')
if (process.argv.includes('--print')) console.log(url)
```

- [ ] **Step 3: fixtures** — render 3 HTML business cards (JA / VI / EN, 1050×600, slight rotation over a desk-coloured background) with Playwright and save PNGs to `tests/fixtures/cards/`. User-supplied real photos may be added to the same folder later.

- [ ] **Step 4: ocr-smoke.mjs**

```js
import { readFileSync, readdirSync } from 'node:fs'
import { loadEnv } from './env.mjs'
import { createGemini } from '../src/services/gemini.js'
const env = loadEnv()
const g = createGemini({ key: env.MEISHI_GEMINI_KEY, model: process.argv[2] || 'gemini-flash-latest' })
const dir = new URL('../tests/fixtures/cards/', import.meta.url)
for (const f of readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f))) {
  const data = readFileSync(new URL(f, dir)).toString('base64')
  const t0 = Date.now()
  const r = await g.extract([{ mimeType: f.endsWith('.png') ? 'image/png' : 'image/jpeg', data }])
  console.log(`\n== ${f} (${Date.now() - t0} ms)\n` + JSON.stringify(r, null, 2))
}
```

- [ ] **Step 5:** `npm run ocr-smoke` → expect 3 JSON results whose `name`, `companyRaw`, `deptPath`, `title`, `rank` match the fixture text (check by eye; JA fixture: 山田 太郎 / ABC商事株式会社 / ["営業本部","第一営業部"] / 課長 / 5). Commit `feat: setup-link and OCR smoke scripts`.

---

### Task 11: App actions (repo service) + live query composable

**Files:** Create `src/services/repo.js`, `src/composables/useLive.js`, `src/lib/image.js`; Test `tests/services/repo.test.js`

Responsibilities of `repo.js` (single module the views call):

```js
// src/services/repo.js  (public API)
export function createRepo({ db, sync, gemini, now = () => new Date().toISOString() })
//  createCard({ front: Blob, back?: Blob, metPlace, metAt, tags, memo }) → id
//      saves images (already resized by caller via lib/image.js) as images/{id}-front.jpg / -back.jpg,
//      card {status:'pending', ocrBy:null, thumb, hasBack, createdAt, updatedAt,...empty fields}, enqueues card + images,
//      then fire-and-forget runOcr(id) and sync.push()
//  runOcr(id) → loads image blobs, gemini.extract, mergeOcr, assignCompany, save+enqueue; on error sets ocrError=e.kind
//  processPending() → runOcr for every card with status 'pending'
//  updateCard(id, patch) → merge, updatedAt=now(), save, enqueue
//  deleteCard(id) → delete card + images locally, enqueue deletes
//  assignCompany(card) → matchCompany(card.companyRaw, companies) or create {id,name:companyRaw,aliases:[],deptAliases:{},placeholders:[]};
//      adds companyRaw to aliases if new spelling; returns card with companyId
//  addPlaceholder(companyId, {name,title,deptPath,rank,reportsTo,memo}), updatePlaceholder, removePlaceholder
//  setDeptAlias(companyId, from, to)
```

- [ ] **Step 1: test** (`tests/services/repo.test.js`) — with fake-indexeddb, a stub sync `{ enqueue: vi.fn(), push: vi.fn() }` and stub gemini returning `{ name:'山田 太郎', companyRaw:'株式会社ABC商事', deptPath:['営業本部'], title:'課長', rank:5, phones:[], emails:[] }`:
  - `createCard` → card exists with status `pending`, images saved, enqueue called with `cards/<id>.json`, `images/<id>-front.jpg`.
  - `runOcr` → status `done`, `companyId` set; a company created with name `株式会社ABC商事`; second card with `ABC商事株式会社` reuses same company and adds alias.
  - gemini rejecting `{kind:'quota'}` → card stays `pending`, `ocrError === 'quota'`.
  - `deleteCard` → enqueue called with `'delete'` for card + front image.

- [ ] **Step 2–4:** implement until green. `lib/image.js` exports `prepareImage(file, { maxSide=1600, quality=0.8, rotate=0 }) → Promise<Blob>` and `makeThumb(blob, 320) → Promise<dataURL>` using `createImageBitmap(file, { imageOrientation: 'from-image' })` + canvas (not unit-tested; covered by Playwright in Task 18). `useLive(fn)` wraps Dexie `liveQuery` into a `shallowRef` and unsubscribes `onScopeDispose`.

- [ ] **Step 5:** Commit `feat: repo actions and live queries`.

---

### Task 12: Design tokens, i18n, shell components

**Files:** `src/styles/tokens.css`, `src/styles/base.css`, `src/i18n/{index.js,ja.json,vi.json,en.json}`, `src/components/{BottomNav,Icon,CardThumb,Banner}.vue`, `src/App.vue`

- Tokens (from canvas): `--bg:#F4F5F7; --surface:#FFFFFF; --ink:#16181D; --ink-2:#3B414C; --muted:#5B6270; --line:#E3E5EA; --line-2:#D6D9E0; --accent:#2F5BD3; --accent-ink:#1E3F9E; --accent-soft:#E8EEFB; --warn-bg:#FFF3D6; --warn-ink:#7A4F00; --ok:#1F7A4D; --danger:#B3261E; --radius:12px`; font `Inter, 'Noto Sans JP', system-ui` (Google Fonts link in index.html). Dark mode not in scope.
- i18n: `createI18n({ legacy:false, locale: getConfig().lang || pick(navigator.language), fallbackLocale:'en' })`; `pick`: ja→ja, vi→vi, else en. Every user-visible string in views comes from the JSON files (same keys in all three; a Vitest test asserts identical key sets).
- `Icon.vue`: prop `name` ∈ {cards, building, book, sliders, search, camera, back, phone, mail, map, copy, contact, rotate, sync, chevron, chevronDown, tree, edit, plus, clock, close}; inline stroke SVG paths copied from the canvas; `aria-hidden="true"`.
- `BottomNav.vue`: 4 router-links (`/`, `/companies`, `/titles`, `/settings`), active state = accent colour, min-height 48px.
- `Banner.vue`: shows sync error (auth → "key hết hạn, quét lại QR"), offline, and conflict count (tap → conflict dialog).
- `App.vue`: `<RouterView/>` + `<BottomNav v-if="route.meta.nav !== false"/>` + `<Banner/>`; on mount and on `online`/`visibilitychange` runs `sync.syncAll()` then `repo.processPending()`.
- [ ] Test `tests/i18n.test.js`: three locale files have identical flattened key sets. Commit `feat: tokens, i18n, shell components`.

---

### Task 13: Setup + Welcome + Settings

**Files:** `src/views/SetupView.vue`, `src/views/WelcomeView.vue`, `src/views/SettingsView.vue`

- SetupView (prop `c`): `decodeSetup(c)` → on error show "Link cài đặt không hợp lệ". On success: call `createGitHub(...).ping()` and `createGemini(...).ping()`; both OK → `saveKeys`, `history.replaceState(null,'',location.pathname + '#/')`, router.replace('/'); else show which one failed and save nothing.
- WelcomeView: logo, "Chưa cài đặt — hãy quét QR cài đặt từ máy tính", link to Titles.
- SettingsView = canvas ⑦ minus key inputs: language segmented (writes `setPref('lang')` + `i18n.global.locale.value`), GitHub card (repo name, ✓/✗ from `ping`, button Kiểm tra), Gemini card (✓/✗, model `<select>` from `models` list filtered to names containing `flash`, saved via `setPref('model')`), "Xóa key khỏi máy này" (confirm → `clearKeys()` + `db.delete()` → `/welcome`), sync card (last sync time from `meta`, outbox count, Sync now), export CSV / vCard (download via Blob + `a[download]`), privacy note.
- [ ] Playwright check (390×844): open `#/setup?c=<real payload>` → lands on `/`, URL has no `c=`; Settings shows ✓ for both. Commit `feat: setup, welcome, settings views`.

### Task 14: List + Capture

**Files:** `src/views/ListView.vue`, `src/views/CaptureView.vue`, `src/components/CardThumb.vue`

- ListView = canvas ①: search (`cardSearchText` + `searchKey(query)` includes), chips Tất cả / Chờ đọc(n) / each tag, sort (newest | name | company), group header by month for "newest", rows → `/card/:id`, pending badge, FAB → `/capture`, pull-to-refresh (touch drag > 70px at scrollTop 0 → `syncAll`), sync status button.
- CaptureView = canvas ②: hidden `<input type="file" accept="image/*" capture="environment">` opened on mount and by "Chụp lại"; preview, rotate 90° (re-run `prepareImage` with rotate), add/replace back side, fields metPlace / metAt (default today) / tags (existing tags as chips + new) / memo; buttons "Lưu & đọc bằng Gemini" (createCard → `/card/:id`) and "Lưu & chụp thẻ tiếp theo" (createCard → reset form, reopen camera); offline hint.
- [ ] Playwright: set file input to fixture PNG, save → Detail shows pending then OCR result (real Gemini). Commit `feat: list and capture views`.

### Task 15: Detail + Edit

**Files:** `src/views/DetailView.vue`, `src/views/EditView.vue`

- DetailView = canvas ③: image via `sync.getImage` (object URL, revoke on unmount), front/back toggle, tap → fullscreen zoom; name/kana/latin, company link → `/company/:companyId?focus=:id`, dept breadcrumb, title chip `title · viFor(title)` → `/titles?q=title`; actions: `tel:`, `mailto:`, `https://maps.google.com/?q=` + address, vCard download (single); "Xem trong sơ đồ tổ chức" → `/company/:companyId?focus=:id`; contact rows with copy (`navigator.clipboard.writeText` + toast); notes section; footer `ocrBy · updatedAt`, Đọc lại (`repo.runOcr`), Xóa (confirm → `deleteCard` → `/`).
- EditView = canvas ④: all fields; AI badge + accent border on fields whose value came from OCR (`ocrBy==='gemini'` and value unchanged since OCR — keep `card.ocrSnapshot` written by `runOcr`); company `<select>` (existing companies + "Tạo công ty mới"); deptPath as editable segment chips (+ Tầng, × remove); title input shows `viFor` hint and auto-sets rank when title changes (user can override rank select 1–7 labelled with `RANK_LABELS`); reportsTo select (people + placeholders of the company, first option "Tự suy ra — <inferred boss>"); phones list (type select + value, add/remove); emails; address; website; Lưu → `updateCard`, Hủy.
- [ ] Playwright: edit memo + title → detail reflects; GitHub file updated (check via `gh api`). Commit `feat: detail and edit views`.

### Task 16: Companies + Org chart (block style)

**Files:** `src/views/CompaniesView.vue`, `src/views/OrgChartView.vue`

- CompaniesView = canvas ⑤: list with initial tile, `n danh thiếp · m người chưa gặp · k chờ đọc`, search, row → `/company/:id`.
- OrgChartView = canvas ⑥: people = company cards (`placeholder:false`) + `company.placeholders` (`placeholder:true`); `org = buildOrg(people, company.deptAliases)`.
  - with `focus`: (1) **Chuỗi báo cáo** = `org.chain(focus)` rendered as vertical cards joined by 2px connectors, last card accent-filled + "Đang xem"; placeholders dashed; (2) **Cùng phòng** = `org.peers(focus)` in 2-column grid.
  - always: (3) **Toàn công ty** block chart: root box (company name + `root.head`), then each level of `children` as a row of boxes (name, head name+title, total) joined by connectors; boxes on `org.pathTo(focus)` get accent border, the deepest one accent fill; a row with > 3 boxes scrolls horizontally (`overflow-x:auto`); tap box → bottom sheet listing that node's people (tap card person → `/card/:id`).
  - Edit mode (header button): add placeholder (sheet with name, title, dept path, rank, reportsTo), rename/merge dept (writes `deptAliases`), set reportsTo for a person (card → `updateCard`, placeholder → company update).
- [ ] Playwright: with 4 test cards of one company, chain order and highlighted path match `buildOrg`. Commit `feat: companies and block org chart`.

### Task 17: Titles dictionary view

**Files:** `src/views/TitlesView.vue`

- Canvas ⑧: header + count, search (prop `q` pre-fills; matches `searchKey` on ja/reading/vi/en), notice about company size, groups by rank with `RANK_LABELS[rank][locale]`, rows: ja + reading | vi + en; empty state. Works without keys and offline.
- [ ] Playwright: `#/titles?q=課長` shows 課長 and 課長代理 only. Commit `feat: title dictionary view`.

### Task 18: PWA icons, build, deploy

**Files:** `public/logo.svg`, `.github/workflows/deploy.yml`

- [ ] **Step 1:** `npx @vite-pwa/assets-generator --preset minimal-2023 public/logo.svg` → `public/pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. Add `<link rel="apple-touch-icon" href="/meishi-app/apple-touch-icon-180x180.png">` to index.html.
- [ ] **Step 2: workflow**

```yaml
name: Deploy
on: { push: { branches: [main] }, workflow_dispatch: {} }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.d.outputs.page_url }}' }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3:** `gh api -X POST repos/ductho20032007-crypto/meishi-app/pages -f build_type=workflow` (enable Pages), push, `gh run watch` → success; `curl -sI https://ductho20032007-crypto.github.io/meishi-app/` → 200.
- [ ] **Step 4:** Commit `ci: deploy to github pages`.

### Task 19: End-to-end verification (Playwright, 390×844, real services)

- [ ] Open the deployed URL via `npm run setup-link -- --print` URL → setup succeeds.
- [ ] Capture each fixture card → OCR results correct; cards appear in `meishi-data` (`gh api repos/.../contents/cards`).
- [ ] Second browser context (simulated 2nd device) via the same setup link → pull shows same cards; edit same field on both → conflict dialog; different fields → auto-merge.
- [ ] Offline (`context.setOffline(true)`) capture → card pending + outbox 1 → back online → pushed + OCR runs.
- [ ] Org chart for the JA company shows chain + highlighted path; Titles search works offline.
- [ ] Language switch JA/VI/EN changes all visible labels.
- [ ] Delete all test cards/companies created during E2E (via app Delete + verify repo empty except README).
- [ ] Generate final `setup-qr.png` for the user's phone.
