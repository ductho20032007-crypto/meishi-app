// src/services/gemini.js
import { matchTitle } from '../lib/rank.js'
export class GeminiError extends Error { constructor(kind, status, message) { super(message); this.kind = kind; this.status = status } }
const STR = { type: 'STRING' }
export const OCR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: STR, nameKana: STR, nameLatin: STR, companyRaw: STR,
    deptPath: { type: 'ARRAY', items: STR }, title: STR, rank: { type: 'INTEGER' },
    phones: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING', enum: ['mobile', 'office', 'fax'] }, value: STR }, required: ['type', 'value'] } },
    emails: { type: 'ARRAY', items: STR }, address: STR, website: STR
  },
  required: ['name', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails']
}
export const OCR_PROMPT = `You read a business card photo (front, optional back) and return JSON only.
Rules:
- Keep text in the original script (Japanese/Vietnamese/English). Do not translate.
- name: person's full name as printed. nameKana: hiragana reading ONLY for Japanese names (furigana printed or confidently inferable); for any other name use "". nameLatin: romanized name if printed, else "".
- companyRaw: company name exactly as printed.
- deptPath: department split from top level to lowest, e.g. "営業本部 第一営業部 1課" → ["営業本部","第一営業部","1課"]. Do NOT include the job title.
- title: job title only (e.g. "課長"), without department.
- rank: 1 chairman/president/CEO; 2 board/officers/VP/vice president; 3 division/branch head, director; 4 department head (部長, trưởng phòng); 5 section head (課長, manager); 6 team lead (係長, 主任); 7 staff/none.
- phones: type mobile for 携帯/mobile/di động/DĐ, Japanese numbers starting 070/080/090, and Vietnamese mobile numbers (+84 3x/5x/7x/8x/9x or 03x/05x/07x/08x/09x); Japanese 050 IP phones are office; fax for FAX; otherwise office.
- Unknown fields: "" or [].`

export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash']
// Reduce "thinking" for speed (OCR needs no reasoning). Sent only when the model accepts it.
export const THINKING_CONFIG = { thinkingLevel: 'low' }
const MISSING = /not found|no longer available|not supported for generateContent/i
const BUSY = /high demand|overloaded/i
const sleepMs = ms => new Promise(r => setTimeout(r, ms))

// Classify a Google API error. Kinds: auth, region, busy, quota, model, bad_request, other
// (plus network / timeout / aborted / bad_response raised elsewhere).
export function classifyError(status, body, statusText = '') {
  const e = body?.error || {}
  const msg = e.message || statusText || ''
  const st = String(e.status || '')
  const reasons = (Array.isArray(e.details) ? e.details : []).map(d => d?.reason)
  let kind
  if (/location is not supported/i.test(msg)) kind = 'region'
  else if (reasons.includes('API_KEY_INVALID') || /API key (not valid|expired)/i.test(msg) || status === 401 || status === 403 || st === 'PERMISSION_DENIED' || st === 'UNAUTHENTICATED') kind = 'auth'
  else if ([500, 502, 503, 504].includes(status) || ['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(st) || BUSY.test(msg)) kind = 'busy'
  else if (status === 429 || st === 'RESOURCE_EXHAUSTED') kind = 'quota'
  else if (status === 404 || st === 'NOT_FOUND' || MISSING.test(msg)) kind = 'model'
  else if (status === 400) kind = 'bad_request'
  else kind = 'other'
  return new GeminiError(kind, status, msg)
}

function makeSignal(user, timeoutMs) {
  const t = AbortSignal.timeout(timeoutMs)
  if (!user) return t
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([user, t])
  const ac = new AbortController()
  const fire = s => () => ac.abort(s.reason)
  if (user.aborted) ac.abort(user.reason)
  else { user.addEventListener('abort', fire(user), { once: true }); t.addEventListener('abort', fire(t), { once: true }) }
  return ac.signal
}

export function createGemini({ key, model, fetch = globalThis.fetch.bind(globalThis), sleep = sleepMs, retryDelay = 2000, timeoutMs = 150000 }) {
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  const models = Array.isArray(model) && model.length ? model : model ? [model] : DEFAULT_MODELS
  const noThinking = new Set()
  async function call(url, init, userSignal) {
    if (userSignal?.aborted) throw new GeminiError('aborted', 0, 'aborted')
    let r
    try { r = await fetch(url, { ...init, signal: makeSignal(userSignal, timeoutMs), headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' } }) }
    catch (e) {
      if (userSignal?.aborted) throw new GeminiError('aborted', 0, 'aborted')
      if (e?.name === 'TimeoutError') throw new GeminiError('timeout', 0, 'request timed out')
      throw new GeminiError('network', 0, e?.message || String(e))
    }
    if (r.ok) return r.json()
    throw classifyError(r.status, await r.json().catch(() => null), r.statusText)
  }
  async function generate(m, images, signal) {
    const gc = { responseMimeType: 'application/json', responseSchema: OCR_SCHEMA, temperature: 0 }
    if (!noThinking.has(m)) gc.thinkingConfig = THINKING_CONFIG
    const parts = [{ text: OCR_PROMPT }]
    images.forEach((i, n) => parts.push({ text: `Image ${n + 1} = ${n === 0 ? 'front' : 'back'}` }, { inlineData: { mimeType: i.mimeType, data: i.data } }))
    const body = { contents: [{ role: 'user', parts }], generationConfig: gc }
    try { return await call(`${base}/models/${m}:generateContent`, { method: 'POST', body: JSON.stringify(body) }, signal) }
    catch (e) {
      if (gc.thinkingConfig && e.status === 400 && /thinking/i.test(e.message)) { noThinking.add(m); return generate(m, images, signal) }
      throw e
    }
  }
  async function withRetry(m, images, signal) {
    try { return await generate(m, images, signal) }
    catch (e) { if (e.kind !== 'busy') throw e; await sleep(retryDelay); return generate(m, images, signal) }
  }
  function parse(j) {
    const c = j?.candidates?.[0]
    const text = c?.content?.parts?.map(p => p.text || '').join('')
    if (!text || (c.finishReason && !['STOP', 'MAX_TOKENS'].includes(c.finishReason))) throw new GeminiError('bad_response', 200, 'empty or blocked response')
    let out
    try { out = sanitizeOcr(JSON.parse(text)) } catch { throw new GeminiError('bad_response', 200, 'unparseable response') }
    if (!out.name && !out.companyRaw && !out.phones.length && !out.emails.length) throw new GeminiError('bad_response', 200, 'nothing recognised')
    return out
  }
  return {
    ping: () => call(`${base}/models?pageSize=1`, { method: 'GET' }),
    async extract(images, { signal } = {}) {
      let busy = null, quota = null, last = null
      for (const m of models) {
        try { return parse(await withRetry(m, images, signal)) }
        catch (e) {
          if (e.kind === 'busy' || e.kind === 'timeout') busy = e // timeout: next model, never retried on the same one
          else if (e.kind === 'quota') quota = e // quotas are per model: try the next one
          else if (e.kind !== 'model' && e.kind !== 'bad_response') throw e
          last = e
        }
      }
      if (busy) throw busy.kind === 'busy' ? busy : new GeminiError('busy', 0, busy.message)
      throw quota || last
    }
  }
}
const s = v => (typeof v === 'string' ? v.trim() : '')
const arr = v => (Array.isArray(v) ? v : [])
export function sanitizeOcr(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new TypeError('OCR result is not an object')
  const title = s(o.title)
  const n = Number(o.rank)
  const modelRank = Number.isInteger(n) && n >= 1 && n <= 7 ? n : null
  const m = matchTitle(title)
  const rank = m.entry ? m.entry.rank : (modelRank ?? m.rank) // dictionary wins over the model
  return {
    name: s(o.name), nameKana: s(o.nameKana), nameLatin: s(o.nameLatin), companyRaw: s(o.companyRaw),
    deptPath: arr(o.deptPath).map(s).filter(Boolean), title, rank,
    phones: arr(o.phones).map(p => ({ type: ['mobile', 'office', 'fax'].includes(p?.type) ? p.type : 'office', value: s(p?.value) })).filter(p => p.value),
    emails: arr(o.emails).map(s).filter(Boolean), address: s(o.address), website: s(o.website)
  }
}
const OCR_FIELDS = ['name', 'nameKana', 'nameLatin', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails', 'address', 'website']
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)
// Pending cards must be created with `rank: null` (not 7) so the OCR rank can fill it.
// ocrSnapshot keeps the raw OCR output for later "AI-filled" badges.
export function mergeOcr(card, ocr) {
  const out = { ...card }
  for (const f of OCR_FIELDS) if (empty(card[f]) && !empty(ocr[f])) out[f] = ocr[f]
  const ocrSnapshot = Object.fromEntries(OCR_FIELDS.map(f => [f, ocr[f]]))
  return { ...out, status: 'done', ocrBy: 'gemini', ocrError: null, ocrSnapshot }
}
