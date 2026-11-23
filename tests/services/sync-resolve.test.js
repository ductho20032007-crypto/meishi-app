// @vitest-environment node
// Conflict resolution keeps both sides' non-conflicting edits; image deletes wait for their card.
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb } from '../../src/services/db.js'
import { createSync } from '../../src/services/sync.js'
import { GitHubError } from '../../src/services/github.js'
import { utf8ToB64, b64ToUtf8 } from '../../src/lib/b64.js'

function fakeGh() {
  const files = new Map(); let n = 0
  return {
    files,
    async ping() {},
    async getTree() { return [...files].map(([path, f]) => ({ path, sha: f.sha })) },
    async getBlob(sha) { return [...files.values()].find(f => f.sha === sha).content },
    async getFile(path) { const f = files.get(path); if (!f) throw new GitHubError('notfound', 404, ''); return f },
    async putFile(path, content, sha) {
      const cur = files.get(path)
      if (!cur && sha) throw new GitHubError('notfound', 404, '')
      if (cur && cur.sha !== sha) throw new GitHubError('conflict', 409, 'sha')
      const s = `s${++n}`; files.set(path, { sha: s, content }); return s
    },
    async deleteFile(path, sha) {
      const cur = files.get(path)
      if (!cur) throw new GitHubError('notfound', 404, '')
      if (cur.sha !== sha) throw new GitHubError('conflict', 409, '')
      files.delete(path)
    }
  }
}
const remoteJson = (gh, path) => JSON.parse(b64ToUtf8(gh.files.get(path).content))
const seed = (gh, path, rec, sha) => gh.files.set(path, { sha, content: utf8ToB64(JSON.stringify(rec)) })
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
let db, gh, sync, i = 0
beforeEach(() => { db = openDb(`sr${++i}-${Math.random()}`); gh = fakeGh(); sync = createSync({ db, gh }) })

const BASE = { id: 'a', name: 'A', memo: '', title: 'T', updatedAt: '1' }
// remote changes name + title, local changes name + memo -> conflict on name only
async function nameConflict() {
  seed(gh, 'cards/a.json', BASE, 'x1'); await sync.pull()
  seed(gh, 'cards/a.json', { ...BASE, name: 'R', title: 'T2', updatedAt: '2' }, 'x2')
  await db.cards.put({ ...BASE, name: 'L', memo: 'mine', updatedAt: '3' }); await sync.enqueue('cards/a.json')
  await sync.push()
  expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['name'])
}

describe('resolve keeps non-conflicting edits of the other side', () => {
  it('keep local: remote title survives, local name + memo pushed', async () => {
    await nameConflict()
    await sync.resolve('cards/a.json', 'local')
    expect(await db.cards.get('a')).toMatchObject({ name: 'L', memo: 'mine', title: 'T2' })
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ name: 'L', memo: 'mine', title: 'T2' })
    expect(await db.outbox.count()).toBe(0)
    expect(await db.conflicts.count()).toBe(0)
  })
  it('keep remote: remote name, local memo kept and pushed', async () => {
    await nameConflict()
    await sync.resolve('cards/a.json', 'remote')
    expect(await db.cards.get('a')).toMatchObject({ name: 'R', memo: 'mine', title: 'T2' })
    await sync.push()
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ name: 'R', memo: 'mine', title: 'T2' })
    expect(await db.outbox.count()).toBe(0)
  })
  it('keep remote with nothing else changed locally: nothing to push', async () => {
    seed(gh, 'cards/a.json', BASE, 'x1'); await sync.pull()
    seed(gh, 'cards/a.json', { ...BASE, name: 'R', updatedAt: '2' }, 'x2')
    await db.cards.put({ ...BASE, name: 'L', updatedAt: '3' }); await sync.enqueue('cards/a.json')
    await sync.push()
    await sync.resolve('cards/a.json', 'remote')
    expect(await db.cards.get('a')).toMatchObject({ name: 'R' })
    expect(await db.outbox.count()).toBe(0)
    expect(gh.files.get('cards/a.json').sha).toBe('x2')
    expect(await sync.pull()).toEqual({ updated: 0, deleted: 0 })
  })
})

describe('internal fields never need the user', () => {
  it('OCR state from a done remote wins, thumb prefers non-empty, no conflict row', async () => {
    const base = { ...BASE, status: 'pending', ocrBy: null, ocrSnapshot: null, thumb: '' }
    seed(gh, 'cards/a.json', base, 'x1'); await sync.pull()
    seed(gh, 'cards/a.json', { ...base, status: 'done', ocrBy: 'gemini', ocrSnapshot: { name: 'R' }, thumb: '' }, 'x2')
    await db.cards.put({ ...base, status: 'done', ocrBy: 'manual', ocrSnapshot: { name: 'L' }, thumb: 'data:image/jpeg;base64,AA', memo: 'm' })
    await sync.enqueue('cards/a.json'); await sync.push()
    expect(await db.conflicts.count()).toBe(0)
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ status: 'done', ocrBy: 'gemini', ocrSnapshot: { name: 'R' }, thumb: 'data:image/jpeg;base64,AA', memo: 'm' })
  })
  it('a real conflict row lists only user fields', async () => {
    const base = { ...BASE, status: 'pending', ocrSnapshot: null }
    seed(gh, 'cards/a.json', base, 'x1'); await sync.pull()
    seed(gh, 'cards/a.json', { ...base, name: 'R', status: 'done', ocrSnapshot: { n: 1 } }, 'x2')
    await db.cards.put({ ...base, name: 'L', status: 'done', ocrSnapshot: { n: 2 } }); await sync.enqueue('cards/a.json'); await sync.push()
    expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['name'])
  })
})

// card + front image synced, then the card is deleted here while another device edited it
async function deleteVsRemoteEdit() {
  seed(gh, 'cards/a.json', { ...BASE, hasBack: false }, 'x1')
  gh.files.set('images/a-front.jpg', { sha: 'i1', content: 'AQID' })
  await sync.pull()
  seed(gh, 'cards/a.json', { ...BASE, memo: 'remote edit' }, 'x2')
  await db.cards.delete('a'); await db.images.delete('images/a-front.jpg')
  await sync.enqueue('cards/a.json', 'delete'); await sync.enqueue('images/a-front.jpg', 'delete')
  await sync.push()
}

describe('image deletes wait for their card', () => {
  it('held while the card delete is in conflict', async () => {
    await deleteVsRemoteEdit()
    expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['*deleted-local'])
    expect(gh.files.has('images/a-front.jpg')).toBe(true)
    expect((await db.outbox.where('path').equals('images/a-front.jpg').first())?.op).toBe('delete')
    await sync.push()   // still held
    expect(gh.files.has('images/a-front.jpg')).toBe(true)
  })
  it('keep cloud restores the card and drops the held image delete', async () => {
    await deleteVsRemoteEdit()
    await sync.resolve('cards/a.json', 'remote')
    expect((await db.cards.get('a')).memo).toBe('remote edit')
    expect(await db.outbox.count()).toBe(0)
    await sync.push()
    expect(gh.files.has('images/a-front.jpg')).toBe(true)
    const img = await sync.getImage('images/a-front.jpg')
    expect(img).toBeTruthy()
  })
  it('keep mine deletes the card, then the image', async () => {
    await deleteVsRemoteEdit()
    await sync.resolve('cards/a.json', 'local')
    expect(gh.files.has('cards/a.json')).toBe(false)
    expect(gh.files.has('images/a-front.jpg')).toBe(false)
    expect(await db.outbox.count()).toBe(0)
  })
  it('a normal delete still removes card and images in one run', async () => {
    seed(gh, 'cards/a.json', BASE, 'x1'); gh.files.set('images/a-front.jpg', { sha: 'i1', content: 'AQID' })
    await sync.pull()
    await db.cards.delete('a')
    await sync.enqueue('cards/a.json', 'delete'); await sync.enqueue('images/a-front.jpg', 'delete')
    await sync.push()
    expect(gh.files.size).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('keep mine on a remotely deleted card re-uploads its images', () => {
  it('re-enqueues images still on this device; hasBack follows the blobs present', async () => {
    seed(gh, 'cards/a.json', { ...BASE, hasBack: true }, 'x1')
    await sync.pull()
    await db.images.put({ path: 'images/a-front.jpg', blob: blob() })
    // the other device deleted the card and its images
    gh.files.delete('cards/a.json')
    await db.cards.update('a', { memo: 'mine' }); await sync.enqueue('cards/a.json'); await sync.push()
    expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['*deleted'])
    await sync.resolve('cards/a.json', 'local')
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ memo: 'mine', hasBack: false })
    expect(gh.files.has('images/a-front.jpg')).toBe(true)
    expect(await db.outbox.count()).toBe(0)
  })
  it('a pull after the *deleted conflict keeps the images; keep mine re-uploads both, hasBack kept', async () => {
    // card + both images created here and synced (files rows exist); another card keeps the remote tree non-empty
    seed(gh, 'cards/z.json', { id: 'z', name: 'Z' }, 'xz')
    await db.cards.put({ ...BASE, hasBack: true })
    await db.images.bulkPut([{ path: 'images/a-front.jpg', blob: blob() }, { path: 'images/a-back.jpg', blob: blob() }])
    for (const p of ['cards/a.json', 'images/a-front.jpg', 'images/a-back.jpg']) await sync.enqueue(p)
    await sync.push()
    expect(await db.files.count()).toBe(3)
    // the other device deletes the card and its images
    for (const p of ['cards/a.json', 'images/a-front.jpg', 'images/a-back.jpg']) gh.files.delete(p)
    await db.cards.update('a', { memo: 'mine' }); await sync.enqueue('cards/a.json')
    await sync.syncAll()   // push -> *deleted conflict, then pull
    expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['*deleted'])
    expect(await db.images.count()).toBe(2)
    expect(await db.files.get('images/a-front.jpg')).toBeTruthy()
    await sync.resolve('cards/a.json', 'local')
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ memo: 'mine', hasBack: true })
    expect(gh.files.has('images/a-front.jpg')).toBe(true)
    expect(gh.files.has('images/a-back.jpg')).toBe(true)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('resolve robustness', () => {
  it('a non-fatal push failure after resolving keeps the resolution and does not reject', async () => {
    await nameConflict()
    const put = gh.putFile
    gh.putFile = async () => { throw new GitHubError('other', 413, 'too big') }
    await expect(sync.resolve('cards/a.json', 'local')).resolves.toBeUndefined()
    expect(await db.conflicts.count()).toBe(0)
    expect((await db.outbox.toArray())[0]).toMatchObject({ path: 'cards/a.json', state: 'error' })
    gh.putFile = put
    await sync.push()
    expect(remoteJson(gh, 'cards/a.json')).toMatchObject({ name: 'L', title: 'T2' })
  })
  it('a fatal push failure propagates with saved: true; the resolution is kept', async () => {
    await nameConflict()
    gh.putFile = async () => { throw new GitHubError('network', 0, 'offline') }
    await expect(sync.resolve('cards/a.json', 'local')).rejects.toMatchObject({ kind: 'network', saved: true })
    expect(await db.conflicts.count()).toBe(0)
    expect(await db.cards.get('a')).toMatchObject({ name: 'L', title: 'T2' })
  })
})
