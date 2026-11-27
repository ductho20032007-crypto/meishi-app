// src/lib/orgChart.js
import { normalizeDept } from './normalize.js'
const SEP = '\u001f'
const rk = p => (typeof p.rank === 'number' && Number.isFinite(p.rank) ? p.rank : 7)
const byRank = (a, b) => (rk(a) - rk(b)) || (a.name || '').localeCompare(b.name || '', 'ja')
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const node = (name, key, parent, unknown = false) => ({ name, key, parent, unknown, children: [], people: [], head: null, total: 0, sources: [] })

// ---- department alias keys ----
// A path-qualified key is the ORIGINAL (pre-alias) dept path, each segment normalised (normalizeDept, "/" escaped as %2F),
// joined with "/"; a top-level department gets a leading "/" ("/営業本部", "営業本部/第一部"). Keys without "/" are legacy
// bare names that apply at every level. A path key wins over a bare one.
const escSeg = s => normalizeDept(s).replace(/%/g, '%25').replace(/\//g, '%2F')
export const deptPathKey = segs => { const k = segs.map(escSeg).join('/'); return segs.length === 1 ? `/${k}` : k }
// path key of a child named `seg` under an already-escaped parent segment list
export const deptPathKeyFrom = (parentEsc, seg) => (parentEsc.length ? `${parentEsc.join('/')}/${escSeg(seg)}` : `/${escSeg(seg)}`)
export const isPathKey = k => String(k).includes('/')
// normalised form of an alias-map key (path keys: per segment; tolerant of spaces / full-width chars)
export const normAliasKey = k => {
  const s = String(k ?? '')
  if (!isPathKey(s)) return normalizeDept(s)
  const parts = s.normalize('NFKC').replace(/^\s*\//, '').split('/').map(x => normalizeDept(x))
  return parts.length === 1 ? `/${parts[0]}` : parts.join('/')
}
// parent part of a path key (array of escaped segments), [] for top level / bare keys
export const pathKeyParent = k => (isPathKey(k) ? normAliasKey(k).replace(/^\//, '').split('/').slice(0, -1) : [])
export const pathKeyLeaf = k => (isPathKey(k) ? normAliasKey(k).split('/').pop().replace(/%2F/g, '/').replace(/%25/g, '%') : normalizeDept(k))
export function aliasLookup(deptAliases = {}) {
  const path = new Map(), bare = new Map()
  for (const [k, v] of Object.entries(deptAliases || {})) (isPathKey(k) ? path : bare).set(normAliasKey(k), v)
  return (pathKey, seg) => path.get(pathKey) ?? bare.get(normalizeDept(seg))
}

// ---- sibling order: numbers (digits or kanji numerals) compare by value ----
const KN = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const KU = { 十: 10, 百: 100, 千: 1000 }
function kanjiNum(s) {
  let total = 0, cur = 0
  for (const ch of s) {
    if (ch in KN) cur = cur * 10 + KN[ch]
    else { total += (cur || 1) * KU[ch]; cur = 0 }
  }
  return total + cur
}
const tokens = s => (String(s || '').normalize('NFKC').match(/\d+|[〇零一二三四五六七八九十百千]+|[^\d〇零一二三四五六七八九十百千]+/g) || [])
  .map(t => (/^\d+$/.test(t) ? { n: Number(t) } : /^[〇零一二三四五六七八九十百千]+$/.test(t) ? { n: kanjiNum(t) } : { s: t }))
export function compareDeptName(a, b) {
  const ta = tokens(a), tb = tokens(b)
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i], y = tb[i]
    if (x.n !== undefined && y.n !== undefined) { if (x.n !== y.n) return x.n - y.n; continue }
    if (x.n !== undefined || y.n !== undefined) return x.n !== undefined ? -1 : 1
    const c = cmp(x.s, y.s); if (c) return c
  }
  return (ta.length - tb.length) || cmp(String(a || ''), String(b || ''))
}

export function buildOrg(people, deptAliases = {}) {
  const alias = aliasLookup(deptAliases)
  const root = node(null, '', null)
  const where = new Map()
  const byId = new Map(people.map(p => [p.id, p]))
  for (const p of people) {
    // [display name, original path key] per level; the key uses the original (pre-alias) path
    const orig = []
    const path = []
    for (const d of p.deptPath || []) {
      if (!normalizeDept(d)) continue
      orig.push(d)
      const pk = deptPathKey(orig)
      const shown = alias(pk, d) ?? d
      if (normalizeDept(shown)) path.push([shown, pk])
    }
    let n = root
    if (!path.length && rk(p) >= 3) {
      n = root.children.find(c => c.unknown) || (root.children.push(node(null, '?', root, true)), root.children.at(-1))
    }
    for (const [seg, pk] of path) {
      const nk = normalizeDept(seg)
      const key = n.key ? `${n.key}${SEP}${nk}` : nk
      let c = n.children.find(x => x.key === key)
      if (!c) { c = node(seg.trim(), key, n); n.children.push(c) }
      if (!c.sources.includes(pk)) c.sources.push(pk)
      n = c
    }
    n.people.push(p); where.set(p.id, n)
  }
  ;(function fin(n) {
    n.people.sort(byRank); n.head = n.people[0] || null
    n.children.sort((a, b) => (a.unknown - b.unknown) || compareDeptName(a.name, b.name))
    n.total = n.people.length + n.children.reduce((s, c) => s + fin(c), 0)
    return n.total
  })(root)

  function inferredBoss(p) {
    const n = where.get(p.id)
    if (!n.unknown && n.head && n.head.id !== p.id && rk(n.head) < rk(p)) return n.head
    for (let a = n.parent; a; a = a.parent) if (!a.unknown && a.head && a.head.id !== p.id) return a.head
    return null
  }
  // explicit reportsTo edges that are accepted (no cycle, not pointing at a subordinate)
  const explicit = new Map()
  const bossOf = p => (explicit.has(p.id) ? byId.get(explicit.get(p.id)) : inferredBoss(p))
  const validTarget = p => (p.reportsTo && p.reportsTo !== p.id && byId.has(p.reportsTo) ? p.reportsTo : null)
  const onCycle = new Set()
  for (const p of people) {
    const seen = new Set([p.id])
    for (let t = validTarget(p); t; t = validTarget(byId.get(t))) {
      if (t === p.id) { onCycle.add(p.id); break }
      if (seen.has(t)) break
      seen.add(t)
    }
  }
  for (const p of people) {
    const t = validTarget(p)
    if (!t || onCycle.has(p.id)) continue
    let sub = false
    for (let c = byId.get(t), i = 0; c && i <= people.length; c = bossOf(c), i++) if (c.id === p.id) { sub = true; break }
    if (!sub) explicit.set(p.id, t)
  }
  function chain(id) {
    const start = byId.get(id); if (!start) return []
    const out = [start]; const seen = new Set([id])
    for (let cur = start; ;) {
      const b = bossOf(cur)
      if (!b || seen.has(b.id)) break
      out.push(b); seen.add(b.id); cur = b
    }
    return out.reverse()
  }
  const peers = id => (where.get(id)?.people || []).filter(p => p.id !== id)
  function pathTo(id) {
    const keys = []
    for (let n = where.get(id); n && n !== root; n = n.parent) keys.unshift(n.key)
    return keys
  }
  return { root, chain, peers, pathTo, nodeOf: id => where.get(id) || null, bossOf: id => (byId.get(id) ? bossOf(byId.get(id)) : null) }
}
