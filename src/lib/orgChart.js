// src/lib/orgChart.js
import { normalizeDept } from './normalize.js'
const byRank = (a, b) => (a.rank - b.rank) || (a.name || '').localeCompare(b.name || '', 'ja')
const node = (name, key, parent, unknown = false) => ({ name, key, parent, unknown, children: [], people: [], head: null, total: 0 })

export function buildOrg(people, deptAliases = {}) {
  const alias = new Map(Object.entries(deptAliases).map(([k, v]) => [normalizeDept(k), v]))
  const root = node(null, '', null)
  const where = new Map()
  const byId = new Map(people.map(p => [p.id, p]))
  for (const p of people) {
    const path = (p.deptPath || []).map(d => alias.get(normalizeDept(d)) ?? d).filter(Boolean)
    let n = root
    if (!path.length && p.rank >= 3) {
      n = root.children.find(c => c.unknown) || (root.children.push(node(null, '?', root, true)), root.children.at(-1))
    }
    for (const seg of path) {
      const key = n.key ? `${n.key}/${seg}` : seg
      let c = n.children.find(x => x.key === key)
      if (!c) { c = node(seg, key, n); n.children.push(c) }
      n = c
    }
    n.people.push(p); where.set(p.id, n)
  }
  ;(function fin(n) {
    n.people.sort(byRank); n.head = n.people[0] || null
    n.children.sort((a, b) => (a.unknown - b.unknown) || ((a.name || '') < (b.name || '') ? -1 : (a.name || '') > (b.name || '') ? 1 : 0))
    n.total = n.people.length + n.children.reduce((s, c) => s + fin(c), 0)
    return n.total
  })(root)

  function inferredBoss(p) {
    const n = where.get(p.id)
    if (n.head && n.head.id !== p.id && n.head.rank < p.rank) return n.head
    for (let a = n.parent; a; a = a.parent) if (a.head && a.head.id !== p.id) return a.head
    return null
  }
  function bossOf(p, explicit = true) {
    if (explicit && p.reportsTo && byId.has(p.reportsTo) && p.reportsTo !== p.id) return byId.get(p.reportsTo)
    return inferredBoss(p)
  }
  function chain(id) {
    const start = byId.get(id); if (!start) return []
    const out = [start]; const seen = new Set([id])
    for (let cur = start; ;) {
      let b = bossOf(cur)
      if (b && seen.has(b.id)) b = bossOf(cur, false)
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
