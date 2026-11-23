// src/services/sync.js
// Conflict policy: JSON records (cards/companies) use a 3-way merge against the last synced base;
// images are last-writer-wins (a local image overwrites the remote one).
import { utf8ToB64, b64ToUtf8, blobToB64, b64ToBlob } from '../lib/b64.js'
import { mergeRecords } from '../lib/merge.js'

const tableOf = path => path.startsWith('cards/') ? 'cards' : path.startsWith('companies/') ? 'companies' : null
const idOf = path => path.split('/').pop().replace(/\.json$/, '')
const APP_PATH = /^(?:(?:cards|companies)\/[^/]+\.json|images\/[^/]+)$/
// abort the whole run (items stay as they are); everything else is per-item
const FATAL = new Set(['network', 'auth', 'ratelimit', 'server', 'repomissing'])
// images/<cardId>-front.jpg -> cards/<cardId>.json
const IMG = /^images\/(.+)-(?:front|back)\.jpg$/
const cardIdOfImage = path => IMG.exec(path)?.[1] ?? null
const imagePaths = id => [`images/${id}-front.jpg`, `images/${id}-back.jpg`]
// order-independent JSON (for "is this the same record" checks)
const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x))
const sameRecord = (a, b) => { const strip = r => ({ ...r, updatedAt: undefined }); return stable(strip(a)) === stable(strip(b)) }
const repoMissing = e => e?.kind === 'notfound' ? Object.assign(new Error('repository not found'), { kind: 'repomissing', status: 404 }) : e

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
    const { merged, conflicts } = mergeRecords((await db.files.get(path))?.base ?? null, localRec, remoteRec)
    // `merged` = both sides' non-conflicting edits (conflicting fields hold the local value)
    if (conflicts.length) return markConflict(item, { local: localRec, remote: remoteRec, remoteSha: remote.sha, fields: conflicts, merged })
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
  // An image delete waits while its card's own outbox item (queued before it) is unprocessed or in conflict:
  // if the user restores the card ("keep cloud"), its images must still be there.
  async function held(item) {
    if (item.op !== 'delete') return false
    const id = cardIdOfImage(item.path)
    if (!id) return false
    const cp = `cards/${id}.json`
    if (await db.conflicts.get(cp)) return true
    const card = await db.outbox.where('path').equals(cp).first()
    return !!card && card.seq < item.seq
  }
  async function _push() {
    const items = await db.outbox.orderBy('seq').filter(i => i.state !== 'conflict').toArray()   // 'error' items are retried every run
    if (items.length) { try { await gh.ping() } catch (e) { throw repoMissing(e) } }   // repo-wide 404 must not be read per-file
    for (const item of items) {
      if (await held(item)) continue
      try { await attempt(item) }
      catch (e) {
        if (FATAL.has(e?.kind)) throw e
        await db.outbox.update(item.seq, { state: 'error', error: e?.kind || 'other' })   // retried on the next run
      }
    }
  }
  const tables = () => [db.cards, db.companies, db.images, db.files, db.outbox]
  async function _pull() {
    let tree
    try { tree = await gh.getTree() } catch (e) { throw repoMissing(e) }
    const remote = new Map(tree.filter(e => APP_PATH.test(e.path)).map(e => [e.path, e.sha]))
    const known = await db.files.toArray()
    // an empty remote while we know of >= 3 synced files looks like a wiped/misread repo, not a mass deletion
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
  // keep 'local' : the merged record (conflicting fields = this device) is pushed over the cloud version;
  //                a remotely deleted card is recreated together with the images still on this device;
  //                a locally deleted record is deleted remotely (its images follow).
  // keep 'remote': the merged record with the cloud's values for the conflicting fields (pushed only when
  //                this device's other edits make it differ from the cloud); a remote deletion deletes here too;
  //                a locally deleted record is restored and its held image deletes are dropped.
  async function _resolve(path, keep) {
    const c = await db.conflicts.get(path); if (!c) return
    const t = tableOf(path), id = idOf(path)
    const both = !!(c.local && c.remote)
    let push = true
    if (keep === 'remote') {
      if (!c.remote) {
        await db[t].delete(id); await db.files.delete(path)
        await db.outbox.where('path').equals(path).delete()
        if (t === 'cards') {
          await db.images.bulkDelete(imagePaths(id))
          await db.outbox.where('path').anyOf(imagePaths(id)).delete()
        }
        push = false
      } else if (both) {
        const result = { ...(c.merged || c.local) }
        for (const f of c.fields || []) { if (f in c.remote) result[f] = c.remote[f]; else delete result[f] }
        const same = sameRecord(result, c.remote)
        await db[t].put(same ? c.remote : result)
        await db.files.put({ path, sha: c.remoteSha, base: c.remote })
        if (same) { await db.outbox.where('path').equals(path).delete(); push = false }
        else await db.outbox.where('path').equals(path).modify({ state: 'ready', op: 'put' })
      } else {
        await db[t].put(c.remote)
        await db.files.put({ path, sha: c.remoteSha, base: c.remote })
        await db.outbox.where('path').equals(path).delete()
        if (t === 'cards') await db.outbox.where('path').anyOf(imagePaths(id)).filter(i => i.op === 'delete').delete()
        push = false
      }
    } else {
      if (both) {
        await db[t].put(c.merged || c.local)
        await db.files.put({ path, sha: c.remoteSha, base: c.remote })
      } else if (c.local) {
        await db.files.delete(path)
        if (t === 'cards') await reuploadImages(id)
      } else {
        await db.files.put({ path, sha: c.remoteSha, base: c.remote })
      }
      await db.outbox.where('path').equals(path).modify({ state: 'ready' })
    }
    await db.conflicts.delete(path)
    if (push) await _push()
  }
  // the card was deleted remotely (with its images): queue the images this device still has; fix hasBack
  async function reuploadImages(id) {
    const [front, back] = imagePaths(id)
    for (const p of [front, back]) {
      if (!(await db.images.get(p))) continue
      await db.files.delete(p)
      await enqueue(p)
    }
    const card = await db.cards.get(id)
    if (card?.hasBack && !(await db.images.get(back))) await db.cards.put({ ...card, hasBack: false })
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
