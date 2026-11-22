// src/lib/orgChart.js
import { normalizeDept } from './normalize.js'
const SEP = '\u001f'
const rk = p => (typeof p.rank === 'number' && Number.isFinite(p.rank) ? p.rank : 7)
const byRank = (a, b) => (rk(a) - rk(b)) || (a.name || '').localeCompare(b.name || '', 'ja')
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const node = (name, key, parent, unknown = false) => ({ name, key, parent, unknown, children: [], people: [], head: null, total: 0 })

export function buildOrg(people, deptAliases = {}) {
  const alias = new Map(Object.entries(deptAliases).map(([k, v]) => [normalizeDept(k), v]))
  const root = node(null, '', null)
  const where = new Map()
  const byId = new Map(people.map(p => [p.id, p]))
  for (const p of people) {
    const path = (p.deptPath || []).map(d => alias.get(normalizeDept(d)) ?? d).filter(d => normalizeDept(d))
    let n = root
    if (!path.length && rk(p) >= 3) {
      n = root.children.find(c => c.unknown) || (root.children.push(node(null, '?', root, true)), root.children.at(-1))
    }
    for (const seg of path) {
      const nk = normalizeDept(seg)
      const key = n.key ? `${n.key}${SEP}${nk}` : nk
      let c = n.children.find(x => x.key === key)
      if (!c) { c = node(seg.trim(), key, n); n.children.push(c) }
      n = c
    }
    n.people.push(p); where.set(p.id, n)
  }
  ;(function fin(n) {
    n.people.sort(byRank); n.head = n.people[0] || null
    n.children.sort((a, b) => (a.unknown - b.unknown) || cmp(a.name || '', b.name || ''))
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
