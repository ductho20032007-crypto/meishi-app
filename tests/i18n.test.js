import { it, expect } from 'vitest'
import ja from '../src/i18n/ja.json'
import vi from '../src/i18n/vi.json'
import en from '../src/i18n/en.json'
import { pickLocale } from '../src/i18n/index.js'

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]).sort()
const at = (m, k) => k.split('.').reduce((o, x) => o[x], m)

it('ja / vi / en have identical flattened key sets', () => {
  expect(flat(ja)).toEqual(flat(en))
  expect(flat(vi)).toEqual(flat(en))
})

it('every message is a non-empty string with the same placeholders', () => {
  for (const k of flat(en)) {
    const ph = m => (at(m, k).match(/\{\w+\}/g) || []).sort()
    for (const m of [ja, vi, en]) expect(typeof at(m, k) === 'string' && at(m, k).trim().length > 0).toBe(true)
    expect(ph(ja)).toEqual(ph(en))
    expect(ph(vi)).toEqual(ph(en))
  }
})

it('picks the locale from navigator.language', () => {
  expect(pickLocale('ja-JP')).toBe('ja')
  expect(pickLocale('vi')).toBe('vi')
  expect(pickLocale('fr-FR')).toBe('en')
  expect(pickLocale(undefined)).toBe('en')
})
