// src/lib/aiFields.js — which card values still hold what Gemini read (for the "AI" badges) and edit diffs.
import { matchCompany } from './normalize.js'
import { sameValue, isEmptyValue } from './values.js'
import { OCR_FIELDS } from '../services/gemini.js'

export { OCR_FIELDS }
export { sameValue, isEmptyValue }

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
// Only the fields that changed between the loaded card and the edited form (so a concurrent OCR / sync update
// to fields the user did not touch is not overwritten on save).
export function diffPatch(original, next, fields = Object.keys(next)) {
  const patch = {}
  for (const f of fields) if (!sameValue(original?.[f], next[f])) patch[f] = next[f]
  return patch
}
