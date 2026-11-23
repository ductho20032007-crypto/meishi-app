import { createRouter, createWebHashHistory } from 'vue-router'
import { hasKeys } from './services/settings.js'
const routes = [
  { path: '/', component: () => import('./views/ListView.vue'), meta: { nav: true } },
  { path: '/capture', component: () => import('./views/CaptureView.vue') },
  { path: '/card/:id', component: () => import('./views/DetailView.vue'), props: true },
  { path: '/card/:id/edit', component: () => import('./views/EditView.vue'), props: true },
  { path: '/companies', component: () => import('./views/CompaniesView.vue'), meta: { nav: true } },
  { path: '/company/:id', component: () => import('./views/OrgChartView.vue'), props: r => ({ id: r.params.id, focus: r.query.focus || null }) },
  { path: '/settings', component: () => import('./views/SettingsView.vue'), meta: { nav: true } },
  { path: '/titles', component: () => import('./views/TitlesView.vue'), props: r => ({ q: r.query.q || '' }), meta: { nav: true } },
  { path: '/setup', component: () => import('./views/SetupView.vue'), props: r => ({ c: r.query.c || '' }) },
  { path: '/welcome', component: () => import('./views/WelcomeView.vue') },
  { path: '/:p(.*)*', redirect: '/' }
]
export const router = createRouter({ history: createWebHashHistory(), routes })
const OPEN = ['/setup', '/titles', '/welcome']
router.beforeEach(to => {
  const keyed = hasKeys()
  if (!keyed && !OPEN.includes(to.path)) return '/welcome'
  if (keyed && to.path === '/welcome') return '/'
  return true
})
