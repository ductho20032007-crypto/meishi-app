// src/lib/values.js — value equality used for "is this still the OCR value" checks.
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
