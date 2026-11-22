// @vitest-environment node
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
