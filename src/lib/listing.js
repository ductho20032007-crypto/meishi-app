// src/lib/listing.js — pure helpers for the card list (filter chips, search, sort, month groups).
import { cardSearchText, searchKey } from './normalize.js'

const pad = n => String(n).padStart(2, '0')
// YYYY-MM-DD in local time (default value of "met on")
export const todayLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// YYYY-MM in local time of an ISO timestamp ('' when missing / invalid)
export function monthKey(iso) {
  const d = new Date(iso || '')
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// tags used on any card, most used first, then alphabetical
export function cardTags(cards) {
  const n = new Map()
  for (const c of cards) for (const t of new Set(c.tags || [])) if (t) n.set(t, (n.get(t) || 0) + 1)
  return [...n.keys()].sort((a, b) => (n.get(b) - n.get(a)) || a.localeCompare(b))
}

// chip: 'all' | 'pending' | 'tag:<name>'; q matches when every word is contained in the card's search text
export function filterCards(cards, { q = '', chip = 'all', companyName = () => '' } = {}) {
  const words = searchKey(q).split(' ').filter(Boolean)
  const tag = chip.startsWith('tag:') ? chip.slice(4) : null
  return cards.filter(c => {
    if (chip === 'pending' && c.status !== 'pending') return false
    if (tag !== null && !(c.tags || []).includes(tag)) return false
    if (!words.length) return true
    const text = cardSearchText(c, companyName(c))
    return words.every(w => text.includes(w))
  })
}

const newest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.id).localeCompare(String(b.id))
const coll = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
// empty keys sort last
const byKey = key => (a, b) => {
  const ka = key(a), kb = key(b)
  if (!ka !== !kb) return ka ? -1 : 1
  return coll.compare(ka, kb)
}
const nameKey = c => (c.nameKana || c.name || c.nameLatin || '').trim()

// sort: 'newest' | 'name' | 'company'
export function sortCards(cards, sort = 'newest', companyName = () => '') {
  const out = [...cards]
  if (sort === 'name') return out.sort((a, b) => byKey(nameKey)(a, b) || newest(a, b))
  if (sort === 'company') {
    const co = c => (companyName(c) || c.companyRaw || '').trim()
    return out.sort((a, b) => byKey(co)(a, b) || byKey(nameKey)(a, b) || newest(a, b))
  }
  return out.sort(newest)
}

// consecutive month groups of an already sorted (newest first) list
export function groupByMonth(cards) {
  const groups = []
  for (const c of cards) {
    const key = monthKey(c.createdAt)
    if (groups.at(-1)?.key !== key) groups.push({ key, items: [] })
    groups.at(-1).items.push(c)
  }
  return groups
}
