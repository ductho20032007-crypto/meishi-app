// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { openDb } from '../../src/services/db.js'
import { createRepo } from '../../src/services/repo.js'

let n = 0
const OCR = { name: '山田 太郎', companyRaw: '株式会社ABC商事', deptPath: ['営業本部'], title: '課長', rank: 5, phones: [], emails: [] }
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
const err = kind => Object.assign(new Error(kind), { kind })
const gate = () => { let open; const p = new Promise(r => { open = r }); return { p, open } }
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

function setup({ extract, autoOcr = false } = {}) {
  const db = openDb(`repo-test-${++n}-${Math.random()}`)
  const sync = { enqueue: vi.fn().mockResolvedValue(), push: vi.fn().mockResolvedValue() }
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
})
