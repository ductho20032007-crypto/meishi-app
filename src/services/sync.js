// src/services/sync.js
// Conflict policy: JSON records (cards/companies) use a 3-way merge against the last synced base;
// images are last-writer-wins (a local image overwrites the remote one).
import { utf8ToB64, b64ToUtf8, blobToB64, b64ToBlob } from '../lib/b64.js'
import { merge3 } from '../lib/merge.js'

const tableOf = path => path.startsWith('cards/') ? 'cards' : path.startsWith('companies/') ? 'companies' : null
const idOf = path => path.split('/').pop().replace(/\.json$/, '')
const APP_PATH = /^(?:(?:cards|companies)\/[^/]+\.json|images\/[^/]+)$/
const FATAL = new Set(['network', 'auth', 'ratelimit'])   // abort the whole run; everything else is per-item

export function createSync({ db, gh }) {
  // single-flight: push / pull / resolve / syncAll never overlap
  let chain = Promise.resolve()
  const exclusive = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }

  async function localContent(path) {
    const t = tableOf(path)
    if (t) { const rec = await db[t].get(idOf(path)); return rec ? { b64: utf8ToB64(JSON.stringify(rec, null, 2)), rec } : null }
    const img = await db.images.get(path)
    return img ? { b64: await blobToB64(img.blob) } : null
  }
  async function enqueue(path, op = 'put') {
    await db.transaction('rw', db.outbox, db.conflicts, async () => {
      await db.outbox.where('path').equals(path).delete()
      await db.conflicts.delete(path)
      await db.outbox.add({ path, op, state: 'ready' })
    })
  }
  async function pushOne(item) {
    const known = await db.files.get(item.path)
    if (item.op === 'delete') {
      if (known?.sha) {
        try { await gh.deleteFile(item.path, known.sha) }
        catch (e) { if (e.kind !== 'notfound') throw e }   // already gone = success
      }
      await db.files.delete(item.path); await db.conflicts.delete(item.path)
      return
    }
    const c = await localContent(item.path)
    if (!c) return
    const sha = await gh.putFile(item.path, c.b64, known?.sha)
    await db.files.put({ path: item.path, sha, base: c.rec ?? null })
    await db.conflicts.delete(item.path)
  }
  async function markConflict(item, row) {
    await db.conflicts.put({ path: item.path, ...row })
    await db.outbox.update(item.seq, { state: 'conflict' })
    return 'conflict'
  }
  async function handleConflict(item) {
    const path = item.path, t = tableOf(path)
    let remote = null
    try { remote = await gh.getFile(path) } catch (e) { if (e.kind !== 'notfound') throw e }
    if (!t) {   // images: last writer wins
      if (remote) await db.files.put({ path, sha: remote.sha, base: null }); else await db.files.delete(path)
      await pushOne(item); return 'done'
    }
    const localRec = item.op === 'delete' ? null : (await db[t].get(idOf(path))) ?? null
    if (!remote) {   // remote deleted
      if (!localRec) { await db.files.delete(path); return 'done' }   // both sides deleted
      return markConflict(item, { local: localRec, remote: null, remoteSha: null, fields: ['*deleted'] })
    }
    const remoteRec = JSON.parse(b64ToUtf8(remote.content))
    if (!localRec) return markConflict(item, { local: null, remote: remoteRec, remoteSha: remote.sha, fields: ['*deleted-local'] })
    const { merged, conflicts } = merge3((await db.files.get(path))?.base ?? null, localRec, remoteRec)
    if (conflicts.length) return markConflict(item, { local: localRec, remote: remoteRec, remoteSha: remote.sha, fields: conflicts })
    await db[t].put(merged)
    await db.files.put({ path, sha: remote.sha, base: remoteRec })
    await pushOne(item); return 'done'
  }
  async function attempt(item) {
    try { await pushOne(item) }
    catch (e) {
      // 404 on a PUT that carried a sha means the file vanished remotely: same path as a sha mismatch
      const vanished = e.kind === 'notfound' && !!(await db.files.get(item.path))?.sha
      if (e.kind !== 'conflict' && !vanished) throw e
      if ((await handleConflict(item)) === 'conflict') return
    }
    await db.outbox.delete(item.seq)
  }
  async function _push() {
    const items = await db.outbox.orderBy('seq').filter(i => i.state === 'ready').toArray()
    for (const item of items) {
      try { await attempt(item) }
      catch (e) {
        if (FATAL.has(e?.kind)) throw e
        await db.outbox.update(item.seq, { state: 'error', error: e?.kind || 'other' })   // retried only when re-enqueued
      }
    }
  }
  const tables = () => [db.cards, db.companies, db.images, db.files, db.outbox]
  async function _pull() {
    const remote = new Map((await gh.getTree()).filter(e => APP_PATH.test(e.path)).map(e => [e.path, e.sha]))
    const known = await db.files.toArray()
    if (remote.size === 0 && known.length >= 3) return { updated: 0, deleted: 0, suspicious: true }
    const pendingNow = path => db.outbox.where('path').equals(path).count()
    let updated = 0, deleted = 0
    for (const [path, sha] of remote) {
      try {
        if ((await db.files.get(path))?.sha === sha) continue
        if (await pendingNow(path)) continue
        const t = tableOf(path)
        let rec = null
        if (t) {
          rec = JSON.parse(b64ToUtf8(await gh.getBlob(sha)))
          if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('not a record')
        }
        const applied = await db.transaction('rw', tables(), async () => {
          if (await pendingNow(path)) return false   // edited locally while we were fetching
          if (t) await db[t].put(rec); else await db.images.delete(path)
          await db.files.put({ path, sha, base: rec })
          return true
        })
        if (applied && t) updated++
      } catch (e) {
        if (FATAL.has(e?.kind)) throw e
        console.warn('pull: skipped', path, e?.message)
      }
    }
    for (const f of known) {
      if (remote.has(f.path) || !APP_PATH.test(f.path)) continue
      const t = tableOf(f.path)
      const done = await db.transaction('rw', tables(), async () => {
        if (await pendingNow(f.path)) return false
        if (t) await db[t].delete(idOf(f.path)); else await db.images.delete(f.path)
        await db.files.delete(f.path)
        return true
      })
      if (done && t) deleted++
    }
    return { updated, deleted }
  }
  async function _resolve(path, keep) {
    const c = await db.conflicts.get(path); if (!c) return
    const t = tableOf(path)
    if (keep === 'remote') {
      if (c.remote) { await db[t].put(c.remote); await db.files.put({ path, sha: c.remoteSha, base: c.remote }) }
      else { await db[t].delete(idOf(path)); await db.files.delete(path) }
      await db.outbox.where('path').equals(path).delete()
      await db.conflicts.delete(path)
      return
    }
    if (c.remoteSha) await db.files.put({ path, sha: c.remoteSha, base: c.remote }); else await db.files.delete(path)
    await db.outbox.where('path').equals(path).modify({ state: 'ready' })
    await db.conflicts.delete(path)
    await _push()
  }
  async function getImage(path) {
    const hit = await db.images.get(path); if (hit) return hit.blob
    const f = await db.files.get(path); if (!f) return null
    const blob = b64ToBlob(await gh.getBlob(f.sha))
    await db.images.put({ path, blob })
    return blob
  }
  return {
    enqueue, getImage,
    push: () => exclusive(_push),
    pull: () => exclusive(_pull),
    resolve: (path, keep) => exclusive(() => _resolve(path, keep)),
    syncAll: () => exclusive(async () => { await _push(); return _pull() })
  }
}
