// src/lib/merge.js
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export function merge3(base, local, remote) {
  const merged = {}; const conflicts = []
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])
  for (const k of keys) {
    const l = local?.[k], r = remote?.[k], b = base?.[k]
    if (k === 'updatedAt') { merged[k] = [l, r].filter(Boolean).sort().at(-1); continue }
    if (eq(l, r)) merged[k] = l
    else if (base && eq(l, b)) merged[k] = r
    else if (base && eq(r, b)) merged[k] = l
    else if (k === 'tags' && Array.isArray(l) && Array.isArray(r)) {
      const u = [...l, ...r.filter(x => !l.includes(x))]
      const bt = Array.isArray(b) ? b : null
      merged[k] = bt ? u.filter(x => !(bt.includes(x) && (!l.includes(x) || !r.includes(x)))) : u
    }
    else { conflicts.push(k); merged[k] = l }
  }
  return { merged, conflicts }
}

// Fields the app maintains itself: resolved automatically, never shown to the user as a conflict.
const OCR_STATE = ['status', 'ocrBy', 'ocrError', 'ocrSnapshot', 'rereadFrom']
const NON_EMPTY = ['thumb', 'hasBack']
export const INTERNAL_FIELDS = [...OCR_STATE, ...NON_EMPTY, 'createdAt', 'updatedAt']
const filled = v => v != null && v !== '' && v !== false
// merge3 + rules: OCR state comes from a remote that finished reading (else stays local); thumb / hasBack prefer
// a non-empty value (local first); createdAt keeps the local value. `conflicts` then lists user fields only.
export function mergeRecords(base, local, remote) {
  const { merged, conflicts } = merge3(base, local, remote)
  const ocrFromRemote = remote?.status === 'done'
  for (const k of conflicts) {
    if (OCR_STATE.includes(k)) {
      const src = ocrFromRemote ? remote : local
      if (k in (src || {})) merged[k] = src[k]; else delete merged[k]
    } else if (NON_EMPTY.includes(k)) merged[k] = filled(local?.[k]) ? local[k] : remote?.[k]
    else if (k === 'createdAt') merged[k] = local?.[k] ?? remote?.[k]
  }
  // OCR state fields move together: if the remote's status won, take all of them from the remote
  if (ocrFromRemote && conflicts.some(k => OCR_STATE.includes(k))) {
    for (const k of OCR_STATE) { if (remote && k in remote) merged[k] = remote[k]; else delete merged[k] }
  }
  return { merged, conflicts: conflicts.filter(k => !INTERNAL_FIELDS.includes(k)) }
}
