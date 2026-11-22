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
  { path: '/welcome', component: () => import('./views/WelcomeView.vue') }
]
export const router = createRouter({ history: createWebHashHistory(), routes })
const OPEN = ['/setup', '/titles', '/welcome']
router.beforeEach(to => (!hasKeys() && !OPEN.includes(to.path)) ? '/welcome' : true)
