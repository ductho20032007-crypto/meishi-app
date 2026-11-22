// src/services/sync.js
import { utf8ToB64, b64ToUtf8, blobToB64, b64ToBlob } from '../lib/b64.js'
import { merge3 } from '../lib/merge.js'

const tableOf = path => path.startsWith('cards/') ? 'cards' : path.startsWith('companies/') ? 'companies' : null
const idOf = path => path.split('/').pop().replace(/\.json$/, '')

export function createSync({ db, gh }) {
  async function localContent(path) {
    const t = tableOf(path)
    if (t) { const rec = await db[t].get(idOf(path)); return rec ? { b64: utf8ToB64(JSON.stringify(rec, null, 2)), rec } : null }
    const img = await db.images.get(path)
    return img ? { b64: await blobToB64(img.blob) } : null
  }
  async function enqueue(path, op = 'put') {
    await db.transaction('rw', db.outbox, async () => {
      await db.outbox.where('path').equals(path).delete()
      await db.outbox.add({ path, op, state: 'ready' })
    })
  }
  async function pushOne(item) {
    const known = await db.files.get(item.path)
    if (item.op === 'delete') {
      if (known?.sha) await gh.deleteFile(item.path, known.sha)
      await db.files.delete(item.path)
      return
    }
    const c = await localContent(item.path)
    if (!c) { await db.outbox.delete(item.seq); return }
    const sha = await gh.putFile(item.path, c.b64, known?.sha)
    await db.files.put({ path: item.path, sha, base: c.rec ?? null })
  }
  async function handleConflict(item) {
    const remote = await gh.getFile(item.path)
    const t = tableOf(item.path)
    if (!t) { await db.files.put({ path: item.path, sha: remote.sha, base: null }); return pushOne(item) }   // images: local wins
    const remoteRec = JSON.parse(b64ToUtf8(remote.content))
    const localRec = await db[t].get(idOf(item.path))
    const { merged, conflicts } = merge3((await db.files.get(item.path))?.base ?? null, localRec, remoteRec)
    if (conflicts.length) {
      await db.conflicts.put({ path: item.path, local: localRec, remote: remoteRec, remoteSha: remote.sha, fields: conflicts })
      await db.outbox.update(item.seq, { state: 'conflict' })
      return 'conflict'
    }
    await db[t].put(merged)
    await db.files.put({ path: item.path, sha: remote.sha, base: remoteRec })
    return pushOne(item)
  }
  async function push() {
    const items = await db.outbox.orderBy('seq').filter(i => i.state === 'ready').toArray()
    for (const item of items) {
      try { await pushOne(item) }
      catch (e) {
        if (e.kind !== 'conflict') throw e
        if ((await handleConflict(item)) === 'conflict') continue
      }
      await db.outbox.delete(item.seq)
    }
  }
  async function pull() {
    const tree = await gh.getTree()
    const remote = new Map(tree.map(e => [e.path, e.sha]))
    const pending = new Set((await db.outbox.toArray()).map(o => o.path))
    let updated = 0, deleted = 0
    for (const [path, sha] of remote) {
      if (pending.has(path)) continue
      const known = await db.files.get(path)
      if (known?.sha === sha) continue
      const t = tableOf(path)
      if (t) {
        const rec = JSON.parse(b64ToUtf8(await gh.getBlob(sha)))
        await db[t].put(rec); await db.files.put({ path, sha, base: rec }); updated++
      } else if (path.startsWith('images/')) {
        await db.images.delete(path); await db.files.put({ path, sha, base: null })
      }
    }
    for (const f of await db.files.toArray()) {
      if (remote.has(f.path) || pending.has(f.path)) continue
      const t = tableOf(f.path)
      if (t) { await db[t].delete(idOf(f.path)); deleted++ } else await db.images.delete(f.path)
      await db.files.delete(f.path)
    }
    return { updated, deleted }
  }
  async function resolve(path, keep) {
    const c = await db.conflicts.get(path); if (!c) return
    const t = tableOf(path)
    await db.files.put({ path, sha: c.remoteSha, base: c.remote })
    if (keep === 'remote') {
      await db[t].put(c.remote)
      await db.outbox.where('path').equals(path).delete()
    } else {
      await db.outbox.where('path').equals(path).modify({ state: 'ready' })
    }
    await db.conflicts.delete(path)
    if (keep !== 'remote') await push()
  }
  async function getImage(path) {
    const hit = await db.images.get(path); if (hit) return hit.blob
    const f = await db.files.get(path); if (!f) return null
    const blob = b64ToBlob(await gh.getBlob(f.sha))
    await db.images.put({ path, blob })
    return blob
  }
  return { enqueue, push, pull, resolve, getImage, async syncAll() { await push(); return pull() } }
}
