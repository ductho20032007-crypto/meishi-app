// src/services/gemini.js
import { rankFor } from '../lib/rank.js'
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
- name: person's full name as printed. nameKana: hiragana reading if furigana printed or confidently inferable, else "". nameLatin: romanized name if printed, else "".
- companyRaw: company name exactly as printed.
- deptPath: department split from top level to lowest, e.g. "営業本部 第一営業部 1課" → ["営業本部","第一営業部","1課"]. Do NOT include the job title.
- title: job title only (e.g. "課長"), without department.
- rank: 1 chairman/president/CEO; 2 board/officers/VP/vice president; 3 division/branch head, director; 4 department head (部長, trưởng phòng); 5 section head (課長, manager); 6 team lead (係長, 主任); 7 staff/none.
- phones: type mobile for 携帯/mobile/di động or numbers starting 070/080/090; fax for FAX; otherwise office.
- Unknown fields: "" or [].`

export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash']
// Reduce "thinking" for speed (OCR needs no reasoning). Sent only when the model accepts it.
export const THINKING_CONFIG = { thinkingLevel: 'low' }
const MISSING = /not found|no longer available|not supported for generateContent/i
const BUSY = /UNAVAILABLE|high demand|overloaded/i
const sleepMs = ms => new Promise(r => setTimeout(r, ms))

export function createGemini({ key, model, fetch = globalThis.fetch.bind(globalThis), sleep = sleepMs, retryDelay = 2000 }) {
  const base = 'https://generativelanguage.googleapis.com/v1beta'
  const models = Array.isArray(model) && model.length ? model : model ? [model] : DEFAULT_MODELS
  const noThinking = new Set()
  async function call(url, init) {
    let r
    try { r = await fetch(url, { ...init, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' } }) }
    catch (e) { throw new GeminiError('network', 0, e.message) }
    if (r.ok) return r.json()
    const msg = (await r.json().catch(() => ({})))?.error?.message || r.statusText || ''
    const kind = r.status === 503 || BUSY.test(msg) ? 'busy'
      : r.status === 404 || MISSING.test(msg) ? 'model'
      : r.status === 429 ? 'quota'
      : [400, 401, 403].includes(r.status) ? 'auth' : 'other'
    throw new GeminiError(kind, r.status, msg)
  }
  async function generate(m, images) {
    const gc = { responseMimeType: 'application/json', responseSchema: OCR_SCHEMA, temperature: 0 }
    if (!noThinking.has(m)) gc.thinkingConfig = THINKING_CONFIG
    const body = { contents: [{ role: 'user', parts: [{ text: OCR_PROMPT }, ...images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))] }], generationConfig: gc }
    try { return await call(`${base}/models/${m}:generateContent`, { method: 'POST', body: JSON.stringify(body) }) }
    catch (e) {
      if (gc.thinkingConfig && e.status === 400 && /thinking/i.test(e.message)) { noThinking.add(m); return generate(m, images) }
      throw e
    }
  }
  async function withRetry(m, images) {
    try { return await generate(m, images) }
    catch (e) { if (e.kind !== 'busy') throw e; await sleep(retryDelay); return generate(m, images) }
  }
  return {
    ping: () => call(`${base}/models?pageSize=1`, { method: 'GET' }),
    async extract(images) {
      let busy = null, quota = null, last = null
      for (const m of models) {
        try {
          const j = await withRetry(m, images)
          const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')
          try { return sanitizeOcr(JSON.parse(text)) } catch { throw new GeminiError('bad_response', 200, 'unparseable response') }
        } catch (e) {
          if (e.kind === 'busy') busy = e
          else if (e.kind === 'quota') quota = e // quotas are per model: try the next one
          else if (e.kind !== 'model') throw e
          last = e
        }
      }
      throw busy || quota || last
    }
  }
}
const s = v => (typeof v === 'string' ? v.trim() : '')
const arr = v => (Array.isArray(v) ? v : [])
export function sanitizeOcr(o) {
  const title = s(o.title)
  const rank = Number.isInteger(o.rank) && o.rank >= 1 && o.rank <= 7 ? o.rank : rankFor(title)
  return {
    name: s(o.name), nameKana: s(o.nameKana), nameLatin: s(o.nameLatin), companyRaw: s(o.companyRaw),
    deptPath: arr(o.deptPath).map(s).filter(Boolean), title, rank,
    phones: arr(o.phones).map(p => ({ type: ['mobile', 'office', 'fax'].includes(p?.type) ? p.type : 'office', value: s(p?.value) })).filter(p => p.value),
    emails: arr(o.emails).map(s).filter(Boolean), address: s(o.address), website: s(o.website)
  }
}
const OCR_FIELDS = ['name', 'nameKana', 'nameLatin', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails', 'address', 'website']
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0)
export function mergeOcr(card, ocr) {
  const out = { ...card }
  for (const f of OCR_FIELDS) if (empty(card[f]) && !empty(ocr[f])) out[f] = ocr[f]
  return { ...out, status: 'done', ocrBy: 'gemini', ocrError: null }
}
