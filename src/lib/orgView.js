// src/lib/orgView.js — pure helpers turning companies / buildOrg() output into render-ready data
// for the Companies list (⑤) and the block org chart (⑥).
import { searchKey, normalizeDept } from './normalize.js'

// ---- companies list ----
const LEGAL_PREFIX = [
  /株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|（有）/g,
  /^\s*công ty\s+(tnhh|cổ phần|cp)?(\s+(một thành viên|mtv))?\s*/i
]
const TINTS = [
  { tint: '#E8EEFB', ink: '#1E3F9E' },
  { tint: '#E3F2EA', ink: '#1F5E3D' },
  { tint: '#FBE9E7', ink: '#8C1D18' },
  { tint: '#FFF3D6', ink: '#7A4F00' },
  { tint: '#EEE8F8', ink: '#4A2F86' }
]

// first visible character of the company name without legal-form words ("株式会社サクラ" -> "サ", "Công ty CP Minh Phát" -> "M")
export function companyInitial(name) {
  let s = String(name || '').normalize('NFKC')
  for (const re of LEGAL_PREFIX) s = s.replace(re, ' ')
  s = s.replace(/[\s.,・·\-_'"()&]+/g, ' ').trim() || String(name || '').trim()
  const ch = [...s][0] || '?'
  return ch.toLocaleUpperCase()
}

// stable colour pair per company id
export function companyTint(id) {
  let h = 0
  for (const ch of String(id || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

// counts per company: { cards, notMet (placeholders), pending (cards waiting for OCR) }
export function companyStats(company, cards) {
  const mine = (cards || []).filter(c => c.companyId === company?.id)
  return {
    cards: mine.length,
    notMet: (company?.placeholders || []).length,
    pending: mine.filter(c => c.status === 'pending').length
  }
}

const coll = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
// companies matching q on name + aliases (accent / width / case / space insensitive), sorted by name
export function filterCompanies(companies, q = '') {
  const words = searchKey(q).split(' ').filter(Boolean)
  const out = (companies || []).filter(co => {
    if (!words.length) return true
    const text = searchKey([co.name, ...(co.aliases || [])].filter(Boolean).join(' '))
    const compact = text.replace(/ /g, '')
    return words.every(w => text.includes(w) || compact.includes(w))
  })
  return out.sort((a, b) => coll.compare(a.name || '', b.name || '') || String(a.id).localeCompare(String(b.id)))
}

// ---- org chart ----
// people of a company for buildOrg: its cards + placeholders (flagged)
export function companyPeople(company, cards) {
  if (!company) return []
  return [
    ...(cards || []).filter(c => c.companyId === company.id).map(c => ({ ...c, placeholder: false })),
    ...(company.placeholders || []).map(p => ({ ...p, placeholder: true }))
  ]
}

// More than this many boxes in one level -> the row scrolls horizontally.
export const WIDE = 3

const boxOf = (n, path, deepest) => ({
  key: n.key, name: n.name, unknown: !!n.unknown, head: n.head, total: n.total,
  onPath: path.has(n.key), deepest: n.key === deepest, hasChildren: n.children.length > 0
})

// Block chart as levels below the root. levels[d] = { groups: [{ parentKey, parentName, parentUnknown, onPath, nodes }], count, wide }.
// Nodes on org.pathTo(focus) get onPath; the last one of that path gets deepest.
export function chartLevels(org, focusId = null) {
  const pathKeys = focusId ? org.pathTo(focusId) : []
  const path = new Set(pathKeys)
  const deepest = pathKeys.at(-1) ?? null
  const levels = []
  let parents = [org.root]
  while (parents.length) {
    const groups = parents.filter(p => p.children.length).map(p => ({
      parentKey: p.key, parentName: p.name, parentUnknown: !!p.unknown, onPath: p === org.root ? !!pathKeys.length : path.has(p.key),
      nodes: p.children.map(c => boxOf(c, path, deepest))
    }))
    if (!groups.length) break
    const count = groups.reduce((s, g) => s + g.nodes.length, 0)
    levels.push({ groups, count, wide: count > WIDE })
    parents = parents.flatMap(p => p.children)
  }
  return { root: { name: null, head: org.root.head, total: org.root.total, onPath: !!focusId && !!org.nodeOf(focusId) }, levels, deepest }
}

// all nodes of the tree (depth-first), for the "rename department" picker: { key, name, unknown, depth, label }
export function deptNodes(org) {
  const out = []
  ;(function walk(n, depth, trail) {
    for (const c of n.children) {
      const t = c.unknown ? trail : [...trail, c.name]
      if (!c.unknown) out.push({ key: c.key, name: c.name, depth, label: t.join(' › ') })
      walk(c, depth + 1, t)
    }
  })(org.root, 0, [])
  return out
}

// dept path (names) of a node key, for the "dept path" chips when adding a placeholder
export function nodePath(org, key) {
  const names = []
  const find = (n) => {
    if (n.key === key) return true
    for (const c of n.children) {
      if (find(c)) { if (!c.unknown) names.unshift(c.name); return true }
    }
    return false
  }
  return find(org.root) ? names : []
}

// the person's dept name shown on chain cards: deepest known department, else ''
export function deptLabel(org, id) {
  const n = org.nodeOf(id)
  return n && !n.unknown && n.name ? n.name : ''
}

// deptAliases after renaming / merging department `from` into `to`: earlier aliases that pointed at `from`
// follow it (buildOrg applies one hop), identity entries are dropped.
export function withDeptAlias(aliases, from, to) {
  const f = String(from ?? '').trim(), d = String(to ?? '').trim()
  const same = (a, b) => normalizeDept(a) === normalizeDept(b)
  const out = {}
  for (const [k, v] of Object.entries(aliases || {})) out[k] = same(v, f) ? d : v
  out[f] = d
  for (const [k, v] of Object.entries(out)) if (same(k, v)) delete out[k]
  return out
}
