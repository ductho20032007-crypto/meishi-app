// src/stores/status.js — small reactive sync / OCR status shared by Banner, Settings and the list.
import { reactive } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../services/db.js'
import { hasKeys } from '../services/settings.js'
import { getApp } from '../services/app.js'

export const status = reactive({
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  syncing: false,
  lastSyncAt: null,          // ISO string, persisted in db.meta('lastSyncAt')
  error: null,               // kind of the last sync error: auth | repomissing | ratelimit | server | network | other
  outboxCount: 0,
  conflictCount: 0,
  pendingCount: 0,           // cards waiting for OCR
  ocr: { runningId: null, queued: [], error: null }
})

const SYNC_KINDS = new Set(['auth', 'repomissing', 'ratelimit', 'server', 'network'])
let boundRepo = null
let unbindOcr = null
let running = null

// Subscribe to the repo's OCR state (re-binds after resetApp() created a new app instance).
function bindApp() {
  if (!hasKeys()) { unbind(); return null }
  const app = getApp()
  if (app.repo !== boundRepo) {
    unbindOcr?.()
    boundRepo = app.repo
    status.ocr = { ...app.repo.ocrState.get() }
    unbindOcr = app.repo.ocrState.subscribe(s => { status.ocr = { ...s } })
  }
  return app
}
function unbind() {
  unbindOcr?.(); unbindOcr = null; boundRepo = null
  status.ocr = { runningId: null, queued: [], error: null }
}

// Starts the live counters once (outbox, conflicts, pending OCR, last sync time).
let sub = null
const setOnline = () => { status.online = true }
const setOffline = () => { status.online = false }
export function startStatus() {
  if (sub) return
  sub = liveQuery(async () => ({
    outbox: await db.outbox.count(),
    conflicts: await db.conflicts.count(),
    pending: await db.cards.where('status').equals('pending').count(),
    last: (await db.meta.get('lastSyncAt'))?.value ?? null
  })).subscribe({
    next: v => {
      status.outboxCount = v.outbox; status.conflictCount = v.conflicts
      status.pendingCount = v.pending; status.lastSyncAt = v.last
    },
    error: e => console.error('status liveQuery', e)
  })
  if (typeof window !== 'undefined') {
    window.addEventListener('online', setOnline)
    window.addEventListener('offline', setOffline)
  }
}
export function stopStatus() {
  sub?.unsubscribe(); sub = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', setOnline)
    window.removeEventListener('offline', setOffline)
  }
  unbind()
}

async function runOnce(ocr) {
  let app
  try { app = bindApp() } catch { app = null }
  if (!app) return
  status.syncing = true
  try {
    await app.sync.syncAll()
    status.error = null
    const at = new Date().toISOString()
    status.lastSyncAt = at
    await db.meta.put({ key: 'lastSyncAt', value: at }).catch(() => {})
  } catch (e) {
    status.error = SYNC_KINDS.has(e?.kind) ? e.kind : 'other'
    console.warn('sync failed', e?.kind || e)
  } finally {
    status.syncing = false
  }
  // OCR runs in the background (serial queue in repo); fatal errors surface through status.ocr.error
  if (ocr) Promise.resolve().then(() => app.repo.processPending()).catch(e => console.warn('processPending', e))
}

// Push + pull, then queue OCR for pending cards. Never throws.
// Single-flight: a call during a run returns that run, unless force — then a NEW run is chained after it
// (used after the keys changed, so the new app instance syncs).
export function syncNow({ ocr = true, force = false } = {}) {
  if (running && !force) return running
  const prev = running
  const p = (async () => {
    if (prev) await prev.catch(() => {})
    await runOnce(ocr)
  })().finally(() => { if (running === p) running = null })
  running = p
  return p
}

// Resolves when no sync run is active.
export async function waitIdle() {
  while (running) await running.catch(() => {})
}

// Called after keys were removed / replaced: drop the old repo binding and bind the new one (if any).
export function resetStatus() {
  unbind()
  status.error = null
  if (!running) status.syncing = false
  try { bindApp() } catch { /* no keys */ }
}
