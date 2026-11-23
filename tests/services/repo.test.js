// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { openDb } from '../../src/services/db.js'
import { createRepo } from '../../src/services/repo.js'
import { createSync } from '../../src/services/sync.js'
import { utf8ToB64 } from '../../src/lib/b64.js'
import Dexie from 'dexie'

let n = 0
const OCR = { name: '山田 太郎', companyRaw: '株式会社ABC商事', deptPath: ['営業本部'], title: '課長', rank: 5, phones: [], emails: [] }
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
const err = kind => Object.assign(new Error(kind), { kind })
const gate = () => { let open; const p = new Promise(r => { open = r }); return { p, open } }
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

function setup({ extract, autoOcr = false, enqueue, getImage } = {}) {
  const db = openDb(`repo-test-${++n}-${Math.random()}`)
  const sync = {
    enqueue: vi.fn(enqueue || (async () => {})),
    push: vi.fn().mockResolvedValue(),
    getImage: vi.fn(getImage || (async path => (await db.images.get(path))?.blob ?? null))
  }
  const gemini = { extract: vi.fn(extract || (async () => ({ ...OCR }))) }
  const repo = createRepo({ db, sync, gemini, autoOcr, now: () => '2026-11-22T00:00:00.000Z' })
  return { db, sync, gemini, repo }
}
const paths = sync => sync.enqueue.mock.calls.map(c => c[0])

describe('createCard', () => {
  it('saves a pending card with rank null and images, enqueues them', async () => {
    const { repo, db, sync } = setup()
    const id = await repo.createCard({ front: blob(), back: blob(), thumb: 'data:x', metPlace: 'HN', metAt: '2026-11-22', tags: ['a'], memo: 'm' })
    const c = await db.cards.get(id)
    expect(c).toMatchObject({
      id, status: 'pending', ocrBy: null, ocrError: null, rank: null, hasBack: true, thumb: 'data:x',
      metPlace: 'HN', metAt: '2026-11-22', tags: ['a'], memo: 'm', companyId: null, reportsTo: null, name: '', deptPath: [],
      createdAt: '2026-11-22T00:00:00.000Z', updatedAt: '2026-11-22T00:00:00.000Z'
    })
    expect(await db.images.get(`images/${id}-front.jpg`)).toBeTruthy()
    expect(await db.images.get(`images/${id}-back.jpg`)).toBeTruthy()
    const p = paths(sync)
    expect(p).toContain(`cards/${id}.json`)
    expect(p).toContain(`images/${id}-front.jpg`)
    expect(p).toContain(`images/${id}-back.jpg`)
  })
  it('auto-starts OCR when enabled', async () => {
    const { repo, db } = setup({ autoOcr: true })
    const id = await repo.createCard({ front: blob() })
    await repo.idle()
    expect((await db.cards.get(id)).status).toBe('done')
  })
})

describe('runOcr', () => {
  it('merges OCR, creates company, reuses it with alias on new spelling', async () => {
    const { repo, db, sync, gemini } = setup()
    const a = await repo.createCard({ front: blob() })
    await repo.runOcr(a)
    const ca = await db.cards.get(a)
    expect(ca).toMatchObject({ status: 'done', ocrBy: 'gemini', rank: 5 })
    expect(ca.companyId).toBeTruthy()
    const cos = await db.companies.toArray()
    expect(cos).toHaveLength(1)
    expect(cos[0]).toMatchObject({ name: '株式会社ABC商事', aliases: [], deptAliases: {}, placeholders: [] })
    expect(sync.push).toHaveBeenCalled()
    expect(gemini.extract.mock.calls[0][0][0]).toMatchObject({ mimeType: 'image/jpeg' })

    gemini.extract.mockResolvedValueOnce({ ...OCR, companyRaw: 'ABC商事株式会社' })
    sync.enqueue.mockClear()
    const b = await repo.createCard({ front: blob() })
    await repo.runOcr(b)
    expect((await db.cards.get(b)).companyId).toBe(ca.companyId)
    const co = await db.companies.get(ca.companyId)
    expect(co.aliases).toEqual(['ABC商事株式会社'])
    expect(paths(sync)).toContain(`companies/${co.id}.json`)
    expect(await db.companies.count()).toBe(1)
  })
  it('quota error keeps pending with ocrError', async () => {
    const { repo, db } = setup({ extract: async () => { throw err('quota') } })
    const id = await repo.createCard({ front: blob() })
    await repo.runOcr(id)
    expect(await db.cards.get(id)).toMatchObject({ status: 'pending', ocrError: 'quota' })
  })
  it('busy error keeps pending with ocrError busy and resolves', async () => {
    const { repo, db } = setup({ extract: async () => { throw err('busy') } })
    const id = await repo.createCard({ front: blob() })
    await repo.runOcr(id)
    expect(await db.cards.get(id)).toMatchObject({ status: 'pending', ocrError: 'busy' })
  })
  it('auth error keeps the card, rejects and is exposed in ocrState', async () => {
    const { repo, db } = setup({ extract: async () => { throw err('auth') } })
    const id = await repo.createCard({ front: blob() })
    await expect(repo.runOcr(id)).rejects.toMatchObject({ kind: 'auth' })
    expect(await db.cards.get(id)).toMatchObject({ status: 'pending', ocrError: 'auth' })
    expect(repo.ocrState.get().error).toBe('auth')
  })
  it('runs strictly one card at a time', async () => {
    let active = 0, max = 0
    const { repo } = setup({
      extract: async () => { active++; max = Math.max(max, active); await tick(10); active--; return { ...OCR } }
    })
    const a = await repo.createCard({ front: blob() }), b = await repo.createCard({ front: blob() })
    await Promise.all([repo.runOcr(a), repo.runOcr(b)])
    expect(max).toBe(1)
  })
  it('reports state to subscribers', async () => {
    const g = gate()
    const { repo } = setup({ extract: async () => { await g.p; return { ...OCR } } })
    const a = await repo.createCard({ front: blob() }), b = await repo.createCard({ front: blob() })
    const seen = []
    repo.ocrState.subscribe(s => seen.push(s))
    const pa = repo.runOcr(a), pb = repo.runOcr(b)
    await tick()
    expect(repo.ocrState.get()).toMatchObject({ runningId: a, queued: [b] })
    g.open()
    await Promise.all([pa, pb])
    expect(repo.ocrState.get()).toMatchObject({ runningId: null, queued: [] })
    expect(seen.length).toBeGreaterThan(1)
  })
})

describe('processPending', () => {
  it('queues all pending cards once', async () => {
    const { repo, db, gemini } = setup()
    const a = await repo.createCard({ front: blob() }), b = await repo.createCard({ front: blob() })
    await repo.runOcr(a)
    gemini.extract.mockClear()
    await repo.processPending()
    expect(gemini.extract).toHaveBeenCalledTimes(1)
    expect((await db.cards.get(b)).status).toBe('done')
  })
})

describe('deleteCard', () => {
  it('deletes locally and enqueues deletes', async () => {
    const { repo, db, sync } = setup()
    const id = await repo.createCard({ front: blob(), back: blob() })
    sync.enqueue.mockClear()
    await repo.deleteCard(id)
    expect(await db.cards.get(id)).toBeUndefined()
    expect(await db.images.get(`images/${id}-front.jpg`)).toBeUndefined()
    expect(sync.enqueue).toHaveBeenCalledWith(`cards/${id}.json`, 'delete')
    expect(sync.enqueue).toHaveBeenCalledWith(`images/${id}-front.jpg`, 'delete')
    expect(sync.enqueue).toHaveBeenCalledWith(`images/${id}-back.jpg`, 'delete')
  })
  it('aborts an in-flight OCR and does not resurrect the card', async () => {
    let sig
    const { repo, db } = setup({
      extract: (imgs, { signal }) => new Promise((_, rej) => {
        sig = signal
        signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))
      })
    })
    const id = await repo.createCard({ front: blob() })
    const p = repo.runOcr(id)
    await tick()
    await repo.deleteCard(id)
    await p
    expect(sig.aborted).toBe(true)
    expect(await db.cards.get(id)).toBeUndefined()
    expect(await db.companies.count()).toBe(0)
  })
})

describe('updateCard', () => {
  it('recomputes rank when title changes, bumps updatedAt, enqueues', async () => {
    const { repo, db, sync } = setup()
    const id = await repo.createCard({ front: blob() })
    sync.enqueue.mockClear()
    const c = await repo.updateCard(id, { title: '部長' })
    expect(c.rank).toBe(4)
    expect((await db.cards.get(id)).title).toBe('部長')
    expect(paths(sync)).toContain(`cards/${id}.json`)
    expect(sync.push).toHaveBeenCalled()
  })
  it('keeps explicit rank', async () => {
    const { repo } = setup()
    const id = await repo.createCard({ front: blob() })
    expect((await repo.updateCard(id, { title: '部長', rank: 2 })).rank).toBe(2)
  })
})

describe('company helpers', () => {
  async function withCompany() {
    const s = setup()
    const id = await s.repo.createCard({ front: blob() })
    await s.repo.runOcr(id)
    const co = (await s.db.companies.toArray())[0]
    s.sync.enqueue.mockClear()
    return { ...s, co }
  }
  it('placeholders', async () => {
    const { repo, db, sync, co } = await withCompany()
    const pid = await repo.addPlaceholder(co.id, { name: '佐藤', title: '部長', deptPath: ['営業本部'] })
    const c = await db.companies.get(co.id)
    expect(c.placeholders).toEqual([expect.objectContaining({ id: pid, name: '佐藤', rank: 4, reportsTo: null })])
    await repo.updatePlaceholder(co.id, pid, { memo: 'x' })
    expect((await db.companies.get(co.id)).placeholders[0].memo).toBe('x')
    await repo.removePlaceholder(co.id, pid)
    expect((await db.companies.get(co.id)).placeholders).toEqual([])
    expect(paths(sync).filter(p => p === `companies/${co.id}.json`)).toHaveLength(3)
  })
  it('deptAlias and rename', async () => {
    const { repo, db, sync, co } = await withCompany()
    await repo.setDeptAlias(co.id, '第1営業部', '第一営業部')
    await repo.renameCompany(co.id, 'ABC')
    const c = await db.companies.get(co.id)
    expect(c.deptAliases).toEqual({ '第1営業部': '第一営業部' })
    expect(c.name).toBe('ABC')
    expect(paths(sync).filter(p => p === `companies/${co.id}.json`)).toHaveLength(2)
  })
  it('parallel addPlaceholder keeps both (read-modify-write is atomic)', async () => {
    const { repo, db, co } = await withCompany()
    await Promise.all([repo.addPlaceholder(co.id, { name: 'x' }), repo.addPlaceholder(co.id, { name: 'y' })])
    expect((await db.companies.get(co.id)).placeholders).toHaveLength(2)
  })
})

describe('OCR finalisation races', () => {
  it('deleteCard during assignCompany: card stays deleted, last op is delete', async () => {
    const { repo, db, sync } = setup()
    const id = await repo.createCard({ front: blob() })
    const orig = db.companies.toArray.bind(db.companies)
    db.companies.toArray = async () => { await repo.deleteCard(id); return orig() }
    await repo.runOcr(id)
    expect(await db.cards.get(id)).toBeUndefined()
    const ops = sync.enqueue.mock.calls.filter(c => c[0] === `cards/${id}.json`)
    expect(ops[ops.length - 1][1]).toBe('delete')
  })
  it('updateCard during assignCompany: user edits preserved', async () => {
    const { repo, db } = setup()
    const id = await repo.createCard({ front: blob() })
    const orig = db.companies.toArray.bind(db.companies)
    db.companies.toArray = async () => { await repo.updateCard(id, { memo: 'USER EDIT', title: '部長' }); return orig() }
    await repo.runOcr(id)
    const c = await db.cards.get(id)
    expect(c).toMatchObject({ memo: 'USER EDIT', title: '部長', status: 'done' })
  })
  it('does not overwrite a card that is no longer pending', async () => {
    const { repo, db } = setup()
    const id = await repo.createCard({ front: blob() })
    const orig = db.companies.toArray.bind(db.companies)
    db.companies.toArray = async () => { await repo.updateCard(id, { status: 'done', ocrBy: 'manual', name: 'Manual' }); return orig() }
    await repo.runOcr(id)
    expect(await db.cards.get(id)).toMatchObject({ name: 'Manual', ocrBy: 'manual' })
  })
  it('keeps a manually chosen companyId', async () => {
    const { repo, db } = setup()
    await db.companies.put({ id: 'coX', name: 'Other', aliases: [], deptAliases: {}, placeholders: [] })
    const id = await repo.createCard({ front: blob() })
    await repo.updateCard(id, { companyId: 'coX' })
    await repo.runOcr(id)
    expect((await db.cards.get(id)).companyId).toBe('coX')
    expect(await db.companies.count()).toBe(1)
  })
  it('assignCompany leaves a card with companyId untouched', async () => {
    const { repo, db } = setup()
    const out = await repo.assignCompany({ companyId: 'c-1', companyRaw: '株式会社新規' })
    expect(out.companyId).toBe('c-1')
    expect(await db.companies.count()).toBe(0)
  })
})

describe('OCR images', () => {
  it('missing front image: no Gemini call, ocrError no_image, stays pending', async () => {
    const { repo, db, gemini, sync } = setup({ getImage: async () => null })
    const id = await repo.createCard({ front: blob() })
    await repo.runOcr(id)
    expect(sync.getImage).toHaveBeenCalledWith(`images/${id}-front.jpg`)
    expect(gemini.extract).not.toHaveBeenCalled()
    expect(await db.cards.get(id)).toMatchObject({ status: 'pending', ocrError: 'no_image' })
  })
})

describe('atomic writes', () => {
  it('every enqueue happens inside the same transaction as its write', async () => {
    const flags = []
    const { repo, db } = setup({ enqueue: async () => { flags.push(!!Dexie.currentTransaction) } })
    const id = await repo.createCard({ front: blob(), back: blob() })
    await repo.updateCard(id, { memo: 'x' })
    await db.companies.put({ id: 'co1', name: 'A', aliases: [], deptAliases: {}, placeholders: [] })
    await repo.renameCompany('co1', 'B')
    await repo.addPlaceholder('co1', { name: 'p' })
    await repo.deleteCard(id)
    expect(flags.length).toBeGreaterThanOrEqual(9)
    expect(flags.every(Boolean)).toBe(true)
  })
  it('a concurrent pull never overwrites a local edit (real sync)', async () => {
    for (let i = 0; i < 5; i++) {
      const db = openDb(`repo-pull-${++n}-${Math.random()}`)
      const local = { id: 'x', status: 'done', memo: '', updatedAt: 'a' }
      await db.cards.put(local)
      await db.files.put({ path: 'cards/x.json', sha: 'old', base: local })
      const gh = {
        getTree: async () => [{ path: 'cards/x.json', sha: 'new' }],
        getBlob: async () => { await tick(i); return utf8ToB64(JSON.stringify({ ...local, memo: 'REMOTE', updatedAt: 'b' })) }
      }
      const sync = createSync({ db, gh })
      const repo = createRepo({ db, sync, gemini: { extract: vi.fn() }, autoOcr: false })
      await Promise.all([sync.pull(), (async () => { await tick(i); await repo.updateCard('x', { memo: 'EDIT' }) })()])
      expect((await db.cards.get('x')).memo).toBe('EDIT')
      expect(await db.outbox.where('path').equals('cards/x.json').count()).toBe(1)
    }
  })
})

describe('dispose and fatal pause', () => {
  it('dispose aborts in-flight OCR, clears queue, later calls are no-ops', async () => {
    let sig
    const { repo, db, gemini } = setup({
      extract: (imgs, { signal }) => new Promise((_, rej) => {
        sig = signal
        signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })))
      })
    })
    const a = await repo.createCard({ front: blob() }), b = await repo.createCard({ front: blob() })
    const pa = repo.runOcr(a), pb = repo.runOcr(b)
    await tick()
    repo.dispose()
    await Promise.all([pa, pb])
    expect(sig.aborted).toBe(true)
    expect(repo.ocrState.get()).toMatchObject({ runningId: null, queued: [] })
    expect(gemini.extract).toHaveBeenCalledTimes(1)
    gemini.extract.mockClear()
    await repo.runOcr(a)
    expect(await repo.processPending()).toEqual([])
    expect(gemini.extract).not.toHaveBeenCalled()
    expect((await db.cards.get(a)).status).toBe('pending')
  })
  it('fatal error pauses the queue until clearOcrError', async () => {
    const { repo, gemini } = setup({ extract: async () => { throw err('auth') } })
    for (let i = 0; i < 3; i++) await repo.createCard({ front: blob() })
    const errs = await repo.processPending()
    expect(errs).toHaveLength(1)
    expect(gemini.extract).toHaveBeenCalledTimes(1)
    expect(await repo.processPending()).toEqual([])
    expect(gemini.extract).toHaveBeenCalledTimes(1)
    repo.clearOcrError()
    expect(repo.ocrState.get().error).toBe(null)
    gemini.extract.mockResolvedValue({ ...OCR })
    await repo.processPending()
    expect(gemini.extract).toHaveBeenCalledTimes(4)
  })
  it('deleteCard on a missing card is a no-op', async () => {
    const { repo, sync } = setup()
    await repo.deleteCard('nope')
    expect(sync.enqueue).not.toHaveBeenCalled()
  })
})

describe('createCompany', () => {
  it('creates a company once and reuses a matching one', async () => {
    const { repo, db, sync } = setup()
    const id = await repo.createCompany('  株式会社サクラシステム ')
    expect(await db.companies.get(id)).toMatchObject({ id, name: '株式会社サクラシステム', aliases: [], placeholders: [], deptAliases: {} })
    expect(paths(sync)).toEqual([`companies/${id}.json`])
    expect(sync.push).toHaveBeenCalled()
    expect(await repo.createCompany('サクラシステム (株)')).toBe(id)
    expect(await db.companies.count()).toBe(1)
    await expect(repo.createCompany('  ')).rejects.toThrow()
  })
})

describe('reread', () => {
  it('keeps all data while pending, then replaces still-AI fields and keeps edits', async () => {
    const { repo, db, gemini } = setup()
    const id = await repo.createCard({ front: blob(), memo: 'm' })
    await repo.runOcr(id)
    const co = (await db.cards.get(id)).companyId
    await repo.updateCard(id, { title: '部長' })
    const g = gate()
    gemini.extract.mockImplementationOnce(async () => { await g.p; return { ...OCR, name: '山田 太郎2', title: '係長', deptPath: ['総務部'] } })
    const p = repo.reread(id)
    await tick(20)
    const mid = await db.cards.get(id)
    expect(mid).toMatchObject({ status: 'pending', ocrError: null, name: '山田 太郎', title: '部長', deptPath: ['営業本部'], companyId: co })
    expect(mid.rereadFrom).toMatchObject({ name: '山田 太郎', title: '課長' })
    g.open(); await p
    const c = await db.cards.get(id)
    expect(c).toMatchObject({ status: 'done', name: '山田 太郎2', title: '部長', rank: 4, deptPath: ['総務部'], memo: 'm', companyId: co })
    expect(c.ocrSnapshot.title).toBe('係長')
    expect('rereadFrom' in c).toBe(false)
  })
  it('a failed re-read keeps every field', async () => {
    const { repo, db, gemini } = setup()
    const id = await repo.createCard({ front: blob() })
    await repo.runOcr(id)
    const before = await db.cards.get(id)
    gemini.extract.mockRejectedValueOnce(err('quota'))
    await repo.reread(id)
    const c = await db.cards.get(id)
    expect(c).toMatchObject({ status: 'pending', ocrError: 'quota', name: before.name, title: before.title, deptPath: before.deptPath, companyId: before.companyId })
  })
  it('keeps a manually chosen company; re-assigns one derived from a changed OCR company', async () => {
    const { repo, db, gemini } = setup()
    const a = await repo.createCard({ front: blob() })
    await repo.runOcr(a)
    const other = await repo.createCompany('XYZ')
    await repo.updateCard(a, { companyId: other })
    gemini.extract.mockResolvedValueOnce({ ...OCR, companyRaw: '株式会社DEF' })
    await repo.reread(a)
    expect((await db.cards.get(a)).companyId).toBe(other)
    const b = await repo.createCard({ front: blob() })
    await repo.runOcr(b)
    const abc = (await db.cards.get(b)).companyId
    gemini.extract.mockResolvedValueOnce({ ...OCR, companyRaw: '株式会社GHI' })
    await repo.reread(b)
    const cb = await db.cards.get(b)
    expect(cb.companyRaw).toBe('株式会社GHI')
    expect(cb.companyId).not.toBe(abc)
    expect((await db.companies.get(cb.companyId)).name).toBe('株式会社GHI')
  })
  it('lifts a fatal pause and retries a pending card', async () => {
    const { repo, db, gemini } = setup()
    const id = await repo.createCard({ front: blob() })
    gemini.extract.mockRejectedValueOnce(err('auth'))
    await repo.runOcr(id).catch(() => {})
    expect(repo.ocrState.get().error).toBe('auth')
    await repo.reread(id)
    expect(repo.ocrState.get().error).toBe(null)
    expect((await db.cards.get(id)).status).toBe('done')
  })
  it('missing card is a no-op', async () => {
    const { repo, gemini } = setup()
    await repo.reread('nope')
    expect(gemini.extract).not.toHaveBeenCalled()
  })
})
