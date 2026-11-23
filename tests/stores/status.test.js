import { it, expect, vi, beforeEach } from 'vitest'

const apps = []
vi.mock('../../src/services/settings.js', () => ({ hasKeys: () => true }))
vi.mock('../../src/services/app.js', () => ({ getApp: () => apps[apps.length - 1] }))

const { status, syncNow, waitIdle, resetStatus } = await import('../../src/stores/status.js')

function fakeApp(name, log) {
  let release
  const gate = new Promise(r => { release = r })
  const subs = new Set()
  const app = {
    name, release,
    sync: { syncAll: async () => { log.push(`start ${name}`); await gate; log.push(`end ${name}`) } },
    repo: {
      processPending: async () => [],
      ocrState: { get: () => ({ runningId: null, queued: [], error: null }), subscribe(fn) { subs.add(fn); return () => subs.delete(fn) } },
      emit: s => subs.forEach(fn => fn(s))
    }
  }
  return app
}
beforeEach(() => { apps.length = 0 })

it('single-flight; force chains a new run on the new app; waitIdle waits for both', async () => {
  const log = []
  const a = fakeApp('a', log); apps.push(a)
  const p1 = syncNow()
  expect(syncNow()).toBe(p1)
  await Promise.resolve()
  expect(status.syncing).toBe(true)
  const b = fakeApp('b', log); apps.push(b)
  resetStatus()
  expect(status.syncing).toBe(true)            // not flipped while a run is active
  const p2 = syncNow({ force: true })
  expect(p2).not.toBe(p1)
  let idle = false
  waitIdle().then(() => { idle = true })
  a.release(); await p1
  await new Promise(r => setTimeout(r, 0))
  expect(log).toEqual(['start a', 'end a', 'start b'])
  expect(idle).toBe(false)
  b.release(); await p2
  await new Promise(r => setTimeout(r, 0))
  expect(idle).toBe(true)
  expect(status.syncing).toBe(false)
  expect(status.lastSyncAt).toBeTruthy()
})

it('status.ocr follows the repo bound by resetStatus', () => {
  const log = []
  const c = fakeApp('c', log); apps.push(c)
  resetStatus()
  c.repo.emit({ runningId: 'x', queued: [], error: 'auth' })
  expect(status.ocr.error).toBe('auth')
})
