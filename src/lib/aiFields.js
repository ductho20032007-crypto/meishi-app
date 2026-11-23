// src/lib/aiFields.js — which card values still hold what Gemini read (for the "AI" badges) and edit diffs.
import { matchCompany } from './normalize.js'

export const OCR_FIELDS = ['name', 'nameKana', 'nameLatin', 'companyRaw', 'deptPath', 'title', 'rank', 'phones', 'emails', 'address', 'website']
const EMPTY = { deptPath: [], phones: [], emails: [], rank: null }

// canonical form: null/undefined -> '', strings trimmed, object keys sorted
function canon(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(canon)
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  return v
}
export const sameValue = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
export const isEmptyValue = v => { const c = canon(v); return c === '' || (Array.isArray(c) && c.length === 0) }

const snap = card => (card?.ocrBy === 'gemini' && card.ocrSnapshot && typeof card.ocrSnapshot === 'object' ? card.ocrSnapshot : null)

// true when `value` (default: the card's own value) is non-empty and equal to what OCR returned for that field
export function aiFilled(card, field, value = card?.[field]) {
  const s = snap(card)
  return !!s && !isEmptyValue(s[field]) && sameValue(value, s[field])
}
// one phone / email entry that OCR returned unchanged
export function aiItem(card, field, item) {
  const list = snap(card)?.[field]
  return Array.isArray(list) && !isEmptyValue(item) && list.some(x => sameValue(x, item))
}
// the selected company is the one OCR read (its name or an alias matches the OCR'd company text)
export function aiCompany(card, company) {
  const raw = snap(card)?.companyRaw
  return !!(company && raw && matchCompany(raw, [company]))
}
// Before re-reading a card: empty every field that still holds the OCR value, so the new OCR result can fill it.
// Fields the user edited are kept (mergeOcr never overwrites non-empty fields).
export function resetAiFields(card) {
  const patch = {}
  for (const f of OCR_FIELDS) if (aiFilled(card, f)) patch[f] = f in EMPTY ? EMPTY[f] : ''
  return patch
}
// Only the fields that changed between the loaded card and the edited form (so a concurrent OCR / sync update
// to fields the user did not touch is not overwritten on save).
export function diffPatch(original, next, fields = Object.keys(next)) {
  const patch = {}
  for (const f of fields) if (!sameValue(original?.[f], next[f])) patch[f] = next[f]
  return patch
}
