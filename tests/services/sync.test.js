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

  const seed = async (path, rec, sha = 'x1') => {
    gh.files.set(path, { sha, content: utf8ToB64(JSON.stringify(rec)) })
  }
  describe('robustness', () => {
    it('delete of an already-gone remote file succeeds', async () => {
      await db.files.put({ path: 'cards/a.json', sha: 'zz', base: null })
      await sync.enqueue('cards/a.json', 'delete'); await sync.push()
      expect(await db.outbox.count()).toBe(0)
      expect(await db.files.get('cards/a.json')).toBeUndefined()
    })
    it('edit of a remotely deleted card -> conflict; keep local recreates', async () => {
      await seed('cards/a.json', { id: 'a', name: 'A' }); await sync.pull()
      gh.files.delete('cards/a.json')
      await db.cards.update('a', { name: 'L' }); await sync.enqueue('cards/a.json'); await sync.push()
      const c = await db.conflicts.get('cards/a.json')
      expect(c).toMatchObject({ fields: ['*deleted'], remote: null, remoteSha: null })
      expect((await db.outbox.toArray())[0].state).toBe('conflict')
      await sync.resolve('cards/a.json', 'local')
      expect(remoteJson(gh, 'cards/a.json').name).toBe('L')
      expect(await db.outbox.count()).toBe(0); expect(await db.conflicts.count()).toBe(0)
    })
    it('edit of a remotely deleted card -> keep remote deletes locally', async () => {
      await seed('cards/a.json', { id: 'a', name: 'A' }); await sync.pull()
      gh.files.delete('cards/a.json')
      await db.cards.update('a', { name: 'L' }); await sync.enqueue('cards/a.json'); await sync.push()
      await sync.resolve('cards/a.json', 'remote')
      expect(await db.cards.get('a')).toBeUndefined()
      expect(await db.files.get('cards/a.json')).toBeUndefined()
      expect(await db.outbox.count()).toBe(0)
    })
    it('local delete vs remote change -> conflict; keep local deletes remote', async () => {
      await seed('cards/a.json', { id: 'a', name: 'A' }); await sync.pull()
      await seed('cards/a.json', { id: 'a', name: 'R' }, 'x9')
      await db.cards.delete('a'); await sync.enqueue('cards/a.json', 'delete'); await sync.push()
      expect((await db.conflicts.get('cards/a.json')).fields).toEqual(['*deleted-local'])
      await sync.resolve('cards/a.json', 'local')
      expect(gh.files.has('cards/a.json')).toBe(false)
      expect(await db.outbox.count()).toBe(0)
    })
    it('local delete vs remote change -> keep remote restores', async () => {
      await seed('cards/a.json', { id: 'a', name: 'A' }); await sync.pull()
      await seed('cards/a.json', { id: 'a', name: 'R' }, 'x9')
      await db.cards.delete('a'); await sync.enqueue('cards/a.json', 'delete'); await sync.push()
      await sync.resolve('cards/a.json', 'remote')
      expect((await db.cards.get('a')).name).toBe('R')
      expect(await db.outbox.count()).toBe(0)
    })
    it('a failing item (413) does not block the next; re-enqueue retries', async () => {
      const put = gh.putFile; let fail = true
      gh.putFile = async (p, ...r) => { if (fail && p === 'cards/a.json') throw new GitHubError('other', 413, 'too big'); return put(p, ...r) }
      await db.cards.bulkPut([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
      await sync.enqueue('cards/a.json'); await sync.enqueue('cards/b.json'); await sync.push()
      expect(gh.files.has('cards/b.json')).toBe(true)
      const left = await db.outbox.toArray()
      expect(left).toHaveLength(1); expect(left[0]).toMatchObject({ path: 'cards/a.json', state: 'error', error: 'other' })
      await sync.push(); expect(gh.files.has('cards/a.json')).toBe(false)   // retried every run, still failing, still not blocking
      expect((await db.outbox.toArray())[0]).toMatchObject({ path: 'cards/a.json', state: 'error', error: 'other' })
      fail = false; await sync.enqueue('cards/a.json'); await sync.push()
      expect(gh.files.has('cards/a.json')).toBe(true); expect(await db.outbox.count()).toBe(0)
    })
    it('notfound on put marks item error and continues', async () => {
      await db.cards.put({ id: 'a', name: 'A' }); await sync.enqueue('cards/a.json')
      gh.putFile = async () => { throw new GitHubError('notfound', 404, '') }
      await sync.push()
      expect((await db.outbox.toArray())[0]).toMatchObject({ state: 'error', error: 'notfound' })
    })
    it('auth errors abort and keep the item ready', async () => {
      gh.putFile = async () => { throw new GitHubError('auth', 401, '') }
      await db.cards.put({ id: 'a', name: 'A' }); await sync.enqueue('cards/a.json')
      await expect(sync.push()).rejects.toMatchObject({ kind: 'auth' })
      expect((await db.outbox.toArray())[0].state).toBe('ready')
    })
    it('single-flight: concurrent syncAll pushes once', async () => {
      const put = gh.putFile; let puts = 0
      gh.putFile = async (...a) => { puts++; await new Promise(r => setTimeout(r, 10)); return put(...a) }
      await db.cards.put({ id: 'a', name: 'A' }); await sync.enqueue('cards/a.json')
      await Promise.all([sync.syncAll(), sync.syncAll()])
      expect(puts).toBe(1); expect(await db.outbox.count()).toBe(0)
    })
    it('enqueue and successful push clear stale conflict rows', async () => {
      await db.conflicts.put({ path: 'cards/a.json', local: {}, remote: {}, remoteSha: 's', fields: ['name'] })
      await db.cards.put({ id: 'a', name: 'A' }); await sync.enqueue('cards/a.json')
      expect(await db.conflicts.count()).toBe(0)
      await db.conflicts.put({ path: 'cards/a.json', local: {}, remote: {}, remoteSha: 's', fields: ['name'] })
      await sync.push()
      expect(await db.conflicts.count()).toBe(0)
    })
    it('pull ignores foreign paths and skips invalid JSON', async () => {
      gh.files.set('cards/README.md', { sha: 'r', content: utf8ToB64('# hi') })
      gh.files.set('cards/sub/x.json', { sha: 'r2', content: utf8ToB64('{}') })
      gh.files.set('cards/bad.json', { sha: 'r3', content: utf8ToB64('{nope') })
      await seed('cards/ok.json', { id: 'ok', name: 'OK' })
      expect(await sync.pull()).toEqual({ updated: 1, deleted: 0 })
      expect(await db.cards.count()).toBe(1)
      expect(await db.files.get('cards/bad.json')).toBeUndefined()
    })
    it('empty remote tree with many local files is treated as suspicious', async () => {
      for (const id of ['a', 'b', 'c']) await seed(`cards/${id}.json`, { id, name: id }, `s-${id}`)
      await sync.pull()
      gh.files.clear()
      expect(await sync.pull()).toEqual({ updated: 0, deleted: 0, suspicious: true })
      expect(await db.cards.count()).toBe(3)
    })
    it('repo-wide 404 aborts as repomissing and leaves the queue untouched; recovers later', async () => {
      await seed('cards/a.json', { id: 'a', name: 'A' }); await seed('cards/c.json', { id: 'c', name: 'C' }, 'x2')
      await sync.pull()
      await db.cards.update('a', { name: 'edited' }); await sync.enqueue('cards/a.json')
      await db.cards.delete('c'); await sync.enqueue('cards/c.json', 'delete')
      const snap = async () => JSON.stringify([await db.outbox.toArray(), await db.files.toArray(), await db.conflicts.toArray()])
      const before = await snap()
      const orig = { ...gh }
      for (const k of ['ping', 'getTree', 'getBlob', 'getFile', 'putFile', 'deleteFile']) gh[k] = async () => { throw new GitHubError('notfound', 404, 'Not Found') }
      await expect(sync.syncAll()).rejects.toMatchObject({ kind: 'repomissing' })
      expect(await snap()).toBe(before)
      Object.assign(gh, orig)
      await sync.syncAll()
      expect(remoteJson(gh, 'cards/a.json').name).toBe('edited'); expect(gh.files.has('cards/c.json')).toBe(false)
      expect(await db.outbox.count()).toBe(0)
    })
    it('pull alone also maps a repo-wide 404 to repomissing', async () => {
      gh.getTree = async () => { throw new GitHubError('notfound', 404, '') }
      await expect(sync.pull()).rejects.toMatchObject({ kind: 'repomissing' })
    })
    it('5xx aborts the run, keeps the item ready, and succeeds on the next run', async () => {
      const put = gh.putFile; let fail = true
      gh.putFile = async (...a) => { if (fail) throw new GitHubError('server', 502, 'bad gateway'); return put(...a) }
      await db.cards.put({ id: 'a', name: 'A' }); await sync.enqueue('cards/a.json')
      await expect(sync.push()).rejects.toMatchObject({ kind: 'server' })
      expect((await db.outbox.toArray())[0].state).toBe('ready')
      fail = false; await sync.push()
      expect(gh.files.has('cards/a.json')).toBe(true); expect(await db.outbox.count()).toBe(0)
    })
  })
})
