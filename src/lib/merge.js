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
