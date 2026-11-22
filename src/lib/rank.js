import { TITLES } from '../data/titles.js'
const VARIANTS = TITLES.flatMap(e => e.ja.split(' / ').map(v => ({ key: v.normalize('NFKC').replace(/\s/g, ''), entry: e })))
// order matters: rank 2 before 1 ("vice president" contains "president"), 4 before 5 ("senior manager")
const FALLBACK = [
  [2, /vice|phó tổng|\bc[a-z]o\b(?<!ceo)|\bvp\b|executive officer/i],
  [1, /\bceo\b|president|chairman|chủ tịch|tổng giám đốc/i],
  [3, /director|giám đốc|head of/i],
  [4, /senior manager|general manager|trưởng phòng/i],
  [5, /manager|phó phòng|trưởng ban/i],
  [6, /leader|supervisor|trưởng nhóm|tổ trưởng/i]
]
export function matchTitle(title) {
  const t = (title || '').normalize('NFKC').replace(/\s/g, '')
  if (!t) return { entry: null, rank: 7 }
  let best = null
  for (const v of VARIANTS) {
    if (!t.includes(v.key)) continue
    if (!best || v.key.length > best.key.length || (v.key.length === best.key.length && v.entry.rank < best.entry.rank)) best = v
  }
  if (best) return { entry: best.entry, rank: best.entry.rank }
  const raw = (title || '').normalize('NFKC')
  for (const [rank, re] of FALLBACK) if (re.test(raw)) return { entry: null, rank }
  return { entry: null, rank: 7 }
}
export const rankFor = t => matchTitle(t).rank
export const viFor = t => matchTitle(t).entry?.vi ?? null
