// src/services/repo.js — single module the views call. Dependencies are injected (see services/app.js).
import { mergeOcr } from './gemini.js'
import { matchCompany, normalizeCompany } from '../lib/normalize.js'
import { newCardId, newCompanyId, newPlaceholderId } from '../lib/ids.js'
import { blobToB64 } from '../lib/b64.js'
import { rankFor } from '../lib/rank.js'

const imgPath = (id, side) => `images/${id}-${side}.jpg`
const cardPath = id => `cards/${id}.json`
const companyPath = id => `companies/${id}.json`
// reported to the UI (banner); everything else (busy/quota/network/timeout/...) is retried by processPending
const FATAL = new Set(['auth', 'region', 'bad_request'])

export function createRepo({ db, sync, gemini, now = () => new Date().toISOString(), autoOcr = true }) {
  const push = () => { try { Promise.resolve(sync.push()).catch(() => {}) } catch { /* ignore */ } }

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
  const jobs = new Map()          // id -> promise (queued or running)
  const controllers = new Map()   // id -> AbortController (running)
  const idle = () => chain

  function runOcr(id) {
    if (jobs.has(id)) return jobs.get(id)
    setState({ queued: [...state.queued, id] })
    const p = chain.then(() => doOcr(id)).finally(() => jobs.delete(id))
    jobs.set(id, p)
    chain = p.catch(() => {})
    return p
  }

  async function doOcr(id) {
    setState({ queued: state.queued.filter(x => x !== id) })
    const card = await db.cards.get(id)
    if (!card || card.status !== 'pending') return
    const ctl = new AbortController()
    controllers.set(id, ctl)
    setState({ runningId: id })
    try {
      const images = []
      for (const side of ['front', 'back']) {
        if (side === 'back' && !card.hasBack) continue
        const img = await db.images.get(imgPath(id, side))
        if (img) images.push({ mimeType: 'image/jpeg', data: await blobToB64(img.blob) })
      }
      const ocr = await gemini.extract(images, { signal: ctl.signal })
      const cur = await db.cards.get(id)
      if (ctl.signal.aborted || !cur) return
      const merged = await assignCompany(mergeOcr(cur, ocr))
      await db.cards.put({ ...merged, updatedAt: now() })
      await sync.enqueue(cardPath(id))
      if (state.error) setState({ error: null })
      push()
    } catch (e) {
      if (ctl.signal.aborted) return
      const kind = e?.kind || 'unknown'
      const cur = await db.cards.get(id)
      if (cur) {
        await db.cards.put({ ...cur, ocrError: kind, updatedAt: now() })
        await sync.enqueue(cardPath(id))
        push()
      }
      if (FATAL.has(kind)) { setState({ error: kind }); throw e }
    } finally {
      controllers.delete(id)
      setState({ runningId: null })
    }
  }

  // Queue every pending card (retries busy/quota/network/timeout). Resolves with the fatal errors, if any.
  async function processPending() {
    const pending = await db.cards.where('status').equals('pending').toArray()
    const errors = []
    await Promise.all(pending.map(c => runOcr(c.id).catch(e => { errors.push(e) })))
    return errors
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
    await db.transaction('rw', db.cards, db.images, async () => {
      await db.images.put({ path: imgPath(id, 'front'), blob: front })
      if (back) await db.images.put({ path: imgPath(id, 'back'), blob: back })
      await db.cards.put(card)
    })
    await sync.enqueue(cardPath(id))
    await sync.enqueue(imgPath(id, 'front'))
    if (back) await sync.enqueue(imgPath(id, 'back'))
    if (autoOcr) { runOcr(id).catch(() => {}); push() }
    return id
  }

  async function updateCard(id, patch) {
    const cur = await db.cards.get(id)
    if (!cur) throw new Error(`card not found: ${id}`)
    const next = { ...cur, ...patch, id, updatedAt: now() }
    if (patch.title !== undefined && patch.title !== cur.title && patch.rank === undefined) next.rank = rankFor(patch.title)
    await db.cards.put(next)
    await sync.enqueue(cardPath(id))
    push()
    return next
  }

  async function deleteCard(id) {
    controllers.get(id)?.abort()
    const cur = await db.cards.get(id)
    await db.transaction('rw', db.cards, db.images, async () => {
      await db.cards.delete(id)
      await db.images.bulkDelete([imgPath(id, 'front'), imgPath(id, 'back')])
    })
    await sync.enqueue(cardPath(id), 'delete')
    await sync.enqueue(imgPath(id, 'front'), 'delete')
    if (!cur || cur.hasBack) await sync.enqueue(imgPath(id, 'back'), 'delete')
    push()
  }

  // ---- companies ----
  async function assignCompany(card) {
    if (!normalizeCompany(card.companyRaw)) return { ...card, companyId: card.companyId ?? null }
    const raw = card.companyRaw
    const companies = await db.companies.toArray()
    const hit = matchCompany(raw, companies)
    if (hit) {
      if (![hit.name, ...(hit.aliases || [])].includes(raw)) {
        await db.companies.put({ ...hit, aliases: [...(hit.aliases || []), raw], updatedAt: now() })
        await sync.enqueue(companyPath(hit.id))
      }
      return { ...card, companyId: hit.id }
    }
    const co = { id: newCompanyId(), name: raw, aliases: [], deptAliases: {}, placeholders: [], updatedAt: now() }
    await db.companies.put(co)
    await sync.enqueue(companyPath(co.id))
    return { ...card, companyId: co.id }
  }

  async function editCompany(companyId, fn) {
    const co = await db.companies.get(companyId)
    if (!co) throw new Error(`company not found: ${companyId}`)
    const next = { ...fn(co), updatedAt: now() }
    await db.companies.put(next)
    await sync.enqueue(companyPath(companyId))
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
    ocrState, idle, createCard, runOcr, processPending, updateCard, deleteCard, assignCompany,
    addPlaceholder, updatePlaceholder, removePlaceholder, setDeptAlias, renameCompany
  }
}
