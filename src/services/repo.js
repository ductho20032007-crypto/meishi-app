// src/services/repo.js — single module the views call. Dependencies are injected (see services/app.js).
// Every write is done in ONE Dexie transaction together with its outbox row (sync.enqueue nests inside it),
// so a concurrent sync pull can never see a changed record without its pending outbox entry.
import { mergeOcr } from './gemini.js'
import { matchCompany, normalizeCompany } from '../lib/normalize.js'
import { newCardId, newCompanyId, newPlaceholderId } from '../lib/ids.js'
import { blobToB64 } from '../lib/b64.js'
import { rankFor } from '../lib/rank.js'

const imgPath = (id, side) => `images/${id}-${side}.jpg`
const cardPath = id => `cards/${id}.json`
const companyPath = id => `companies/${id}.json`
// reported to the UI (banner) and pause the queue; everything else (busy/quota/network/timeout/no_image/...) is retried by processPending
const FATAL = new Set(['auth', 'region', 'bad_request'])

export function createRepo({ db, sync, gemini, now = () => new Date().toISOString(), autoOcr = true }) {
  const push = () => { try { Promise.resolve(sync.push()).catch(() => {}) } catch { /* ignore */ } }
  const tx = fn => db.transaction('rw', db.cards, db.companies, db.images, db.outbox, db.conflicts, fn)

  // ---- OCR state (observable) ----
  let state = { runningId: null, queued: [], error: null }
  const subs = new Set()
  const setState = patch => { state = { ...state, ...patch }; subs.forEach(fn => { try { fn(state) } catch { /* ignore */ } }) }
  const ocrState = {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
  }

  // ---- serial OCR queue (one card at a time to save free-tier quota) ----
  let chain = Promise.resolve()
  let disposed = false
  let paused = false              // set by a fatal error (auth/region/bad_request) until clearOcrError()
  const jobs = new Map()          // id -> promise (queued or running)
  const controllers = new Map()   // id -> AbortController (running)
  const idle = () => chain

  function runOcr(id) {
    if (disposed) return Promise.resolve()
    if (jobs.has(id)) return jobs.get(id)
    setState({ queued: [...state.queued, id] })
    const p = chain.then(() => doOcr(id)).finally(() => jobs.delete(id))
    jobs.set(id, p)
    chain = p.catch(() => {})
    return p
  }

  async function loadImages(id, card) {
    const front = await sync.getImage(imgPath(id, 'front'))
    if (!front) throw Object.assign(new Error('front image unavailable'), { kind: 'no_image' })
    const images = [{ mimeType: 'image/jpeg', data: await blobToB64(front) }]
    if (card.hasBack) {
      const back = await sync.getImage(imgPath(id, 'back'))
      if (back) images.push({ mimeType: 'image/jpeg', data: await blobToB64(back) })
    }
    return images
  }

  async function doOcr(id) {
    setState({ queued: state.queued.filter(x => x !== id) })
    if (disposed || paused) return
    const card = await db.cards.get(id)
    if (!card || card.status !== 'pending') return
    const ctl = new AbortController()
    controllers.set(id, ctl)
    setState({ runningId: id })
    try {
      const images = await loadImages(id, card)
      const ocr = await gemini.extract(images, { signal: ctl.signal })
      const cur = await db.cards.get(id)
      if (ctl.signal.aborted || !cur) return
      // resolve the company first (own transaction), then finalise the card atomically against a fresh read
      const companyId = cur.companyId || (await assignCompany(mergeOcr(cur, ocr))).companyId
      const saved = await tx(async () => {
        const c2 = await db.cards.get(id)
        if (!c2 || ctl.signal.aborted || c2.status !== 'pending') return false
        await db.cards.put({ ...mergeOcr(c2, ocr), companyId: c2.companyId || companyId || null, updatedAt: now() })
        await sync.enqueue(cardPath(id))
        return true
      })
      if (saved) { if (state.error) setState({ error: null }); push() }
    } catch (e) {
      if (ctl.signal.aborted) return
      const kind = e?.kind || 'unknown'
      try {
        const wrote = await tx(async () => {
          const c = await db.cards.get(id)
          if (!c || c.status !== 'pending' || c.ocrError === kind) return false
          await db.cards.put({ ...c, ocrError: kind, updatedAt: now() })
          await sync.enqueue(cardPath(id))
          return true
        })
        if (wrote) push()
      } catch { /* best effort: the card stays pending and is retried */ }
      if (FATAL.has(kind)) { paused = true; setState({ error: kind }); throw e }
    } finally {
      controllers.delete(id)
      setState({ runningId: null })
    }
  }

  // Queue every pending card (retries busy/quota/network/timeout/no_image). Resolves with the fatal errors, if any.
  async function processPending() {
    if (disposed || paused) return []
    const pending = await db.cards.where('status').equals('pending').toArray()
    const errors = []
    await Promise.all(pending.map(c => runOcr(c.id).catch(e => { errors.push(e) })))
    return errors
  }

  function clearOcrError() { paused = false; setState({ error: null }) }

  function dispose() {
    disposed = true
    controllers.forEach(c => c.abort())
    setState({ queued: [], runningId: null })
    subs.clear()
  }

  // ---- cards ----
  async function createCard({ front, back = null, thumb = '', metPlace = '', metAt = '', tags = [], memo = '' }) {
    const id = newCardId()
    const t = now()
    const card = {
      id, status: 'pending', ocrBy: null, ocrError: null,
      name: '', nameKana: '', nameLatin: '', companyId: null, companyRaw: '', deptPath: [], title: '', rank: null, reportsTo: null,
      phones: [], emails: [], address: '', website: '', memo, tags, metAt, metPlace,
      hasBack: !!back, thumb, createdAt: t, updatedAt: t
    }
    await tx(async () => {
      await db.images.put({ path: imgPath(id, 'front'), blob: front })
      if (back) await db.images.put({ path: imgPath(id, 'back'), blob: back })
      await db.cards.put(card)
      await sync.enqueue(cardPath(id))
      await sync.enqueue(imgPath(id, 'front'))
      if (back) await sync.enqueue(imgPath(id, 'back'))
    })
    if (autoOcr) { runOcr(id).catch(() => {}); push() }
    return id
  }

  async function updateCard(id, patch) {
    const next = await tx(async () => {
      const cur = await db.cards.get(id)
      if (!cur) throw new Error(`card not found: ${id}`)
      const n = { ...cur, ...patch, id, updatedAt: now() }
      if (patch.title !== undefined && patch.title !== cur.title && patch.rank === undefined) n.rank = rankFor(patch.title)
      await db.cards.put(n)
      await sync.enqueue(cardPath(id))
      return n
    })
    push()
    return next
  }

  async function deleteCard(id) {
    controllers.get(id)?.abort()
    const removed = await tx(async () => {
      const cur = await db.cards.get(id)
      if (!cur) return false
      await db.cards.delete(id)
      await db.images.bulkDelete([imgPath(id, 'front'), imgPath(id, 'back')])
      await sync.enqueue(cardPath(id), 'delete')
      await sync.enqueue(imgPath(id, 'front'), 'delete')
      if (cur.hasBack) await sync.enqueue(imgPath(id, 'back'), 'delete')
      return true
    })
    if (removed) push()
  }

  // ---- companies ----
  // Resolves the company for a card (does not touch the card record). A card that already has a companyId is left alone.
  async function assignCompany(card) {
    if (card.companyId) return card
    if (!normalizeCompany(card.companyRaw)) return { ...card, companyId: null }
    const raw = card.companyRaw
    const hit = matchCompany(raw, await db.companies.toArray())
    if (hit) {
      await tx(async () => {
        const co = await db.companies.get(hit.id)
        if (!co || [co.name, ...(co.aliases || [])].includes(raw)) return
        await db.companies.put({ ...co, aliases: [...(co.aliases || []), raw], updatedAt: now() })
        await sync.enqueue(companyPath(co.id))
      })
      return { ...card, companyId: hit.id }
    }
    const co = { id: newCompanyId(), name: raw, aliases: [], deptAliases: {}, placeholders: [], updatedAt: now() }
    await tx(async () => {
      await db.companies.put(co)
      await sync.enqueue(companyPath(co.id))
    })
    return { ...card, companyId: co.id }
  }

  async function editCompany(companyId, fn) {
    const next = await tx(async () => {
      const co = await db.companies.get(companyId)
      if (!co) throw new Error(`company not found: ${companyId}`)
      const n = { ...fn(co), updatedAt: now() }
      await db.companies.put(n)
      await sync.enqueue(companyPath(companyId))
      return n
    })
    push()
    return next
  }

  async function addPlaceholder(companyId, { name = '', title = '', deptPath = [], rank, reportsTo = null, memo = '' } = {}) {
    const ph = { id: newPlaceholderId(), name, title, deptPath, rank: rank ?? rankFor(title), reportsTo, memo }
    await editCompany(companyId, co => ({ ...co, placeholders: [...(co.placeholders || []), ph] }))
    return ph.id
  }
  const updatePlaceholder = (companyId, phId, patch) =>
    editCompany(companyId, co => ({ ...co, placeholders: (co.placeholders || []).map(p => p.id === phId ? { ...p, ...patch, id: phId } : p) }))
  const removePlaceholder = (companyId, phId) =>
    editCompany(companyId, co => ({ ...co, placeholders: (co.placeholders || []).filter(p => p.id !== phId) }))
  const setDeptAlias = (companyId, from, to) =>
    editCompany(companyId, co => ({ ...co, deptAliases: { ...(co.deptAliases || {}), [from]: to } }))
  const renameCompany = (companyId, name) => editCompany(companyId, co => ({ ...co, name }))

  return {
    ocrState, idle, dispose, clearOcrError, createCard, runOcr, processPending, updateCard, deleteCard, assignCompany,
    addPlaceholder, updatePlaceholder, removePlaceholder, setDeptAlias, renameCompany
  }
}
