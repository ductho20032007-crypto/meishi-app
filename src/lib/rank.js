import { TITLES } from '../data/titles.js'
const norm = s => (s || '').normalize('NFKC').trim().toLowerCase()
const VARIANTS = TITLES.flatMap(e => e.ja.split(' / ').map(v => ({ key: v.normalize('NFKC').replace(/\s/g, ''), entry: e })))
// exact English / Vietnamese names -> entries (first entry wins; ambiguous ranks are skipped)
const EXACT = new Map()
for (const e of TITLES) {
  for (const n of [...e.en.split(' / '), ...e.vi.split(' / ')].map(norm)) {
    if (!EXACT.has(n)) EXACT.set(n, [])
    EXACT.get(n).push(e)
  }
}
// order matters: rank 1 CEO before 2, 2 before 1 ("vice president" contains "president"), 4 before 5 ("senior manager")
const FALLBACK = [
  [1, /\bceo\b|chief executive officer/i],
  [2, /\bvice\b|phó tổng|\b(c[a-z]o|svp|evp|vp)\b(?<!ceo)|(?<!chief )executive officer|chief (?!executive).* officer/i],
  [1, /president|chairman|chủ tịch|tổng giám đốc/i],
  [3, /director|giám đốc|head of/i],
  [4, /senior manager|general manager|trưởng phòng|phó phòng/i],
  [5, /manager|trưởng ban/i],
  [6, /leader|supervisor|trưởng nhóm|tổ trưởng/i]
]
const pick = (a, b, t) => {
  if (!a) return b
  if (b.key.length !== a.key.length) return b.key.length > a.key.length ? b : a
  const sa = t.endsWith(a.key), sb = t.endsWith(b.key)
  if (sa !== sb) return sb ? b : a
  return b.entry.rank < a.entry.rank ? b : a
}
export function matchTitle(title) {
  const raw0 = (title || '').normalize('NFKC')
  if (raw0.includes('兼')) {
    // concurrent posts ("次長兼課長"): evaluate each part, the highest post wins; ties -> part with an entry, then the first
    const parts = raw0.split('兼').map(x => x.trim()).filter(Boolean)
    if (parts.length > 1) {
      return parts.map(matchOne).reduce((a, b) => {
        if (b.rank !== a.rank) return b.rank < a.rank ? b : a
        return !a.entry && b.entry ? b : a
      })
    }
  }
  return matchOne(title)
}
function matchOne(title) {
  const t = (title || '').normalize('NFKC').replace(/\s/g, '')
  if (!t) return { entry: null, rank: 7 }
  const hits = VARIANTS.filter(v => t.includes(v.key))
  if (hits.length) {
    let best
    if (hits.some(v => v.key.includes('取締役') && t.startsWith(v.key))) {
      // board-director prefix ("取締役社長", "代表取締役会長"): the highest post wins; ties -> suffix, then longest
      best = hits.reduce((a, b) => {
        if (!a) return b
        if (a.entry.rank !== b.entry.rank) return b.entry.rank < a.entry.rank ? b : a
        const sa = t.endsWith(a.key), sb = t.endsWith(b.key)
        if (sa !== sb) return sb ? b : a
        return b.key.length > a.key.length ? b : a
      }, null)
    } else {
      best = hits.reduce((a, b) => pick(a, b, t), null)
    }
    const idx = t.endsWith(best.key) ? t.length - best.key.length : t.indexOf(best.key)
    if (idx > 0 && t[idx - 1] === '副' && !best.key.startsWith('副')) {
      return { entry: null, rank: Math.min(7, best.entry.rank + 1) }
    }
    return { entry: best.entry, rank: best.entry.rank }
  }
  const ex = EXACT.get(norm(title))
  if (ex && new Set(ex.map(e => e.rank)).size === 1) return { entry: ex[0], rank: ex[0].rank }
  const raw = (title || '').normalize('NFKC')
  for (const [rank, re] of FALLBACK) if (re.test(raw)) return { entry: null, rank }
  return { entry: null, rank: 7 }
}
export const rankFor = t => matchTitle(t).rank
export const viFor = t => matchTitle(t).entry?.vi ?? null
