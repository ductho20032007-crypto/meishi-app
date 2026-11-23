// src/lib/titleSearch.js — search + rank groups for the title dictionary (⑧).
import { TITLES } from '../data/titles.js'
import { searchKey } from './normalize.js'

const INDEX = TITLES.map(e => {
  const text = searchKey([e.ja, e.reading, e.vi, e.en].join(' '))
  return { e, text, compact: text.replace(/ /g, '') }
})

// entries matching every word of q (accent / width / case insensitive; "課 長" and "section manager" both work)
export function searchTitles(q = '') {
  const key = searchKey(q)
  if (!key) return INDEX.map(x => x.e)
  const words = key.split(' ')
  const whole = key.replace(/ /g, '')
  return INDEX.filter(x => x.compact.includes(whole) || words.every(w => x.text.includes(w) || x.compact.includes(w))).map(x => x.e)
}

// [{ rank, items }] in rank order 1 -> 7, empty ranks dropped; entry order kept within a rank
export function groupByRank(entries) {
  const m = new Map()
  for (const e of entries) {
    if (!m.has(e.rank)) m.set(e.rank, [])
    m.get(e.rank).push(e)
  }
  return [...m.keys()].sort((a, b) => a - b).map(rank => ({ rank, items: m.get(rank) }))
}

export const TITLE_COUNT = TITLES.length
