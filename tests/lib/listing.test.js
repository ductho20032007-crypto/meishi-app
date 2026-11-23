import { it, expect, describe } from 'vitest'
import { cardTags, filterCards, sortCards, groupByMonth, monthKey, todayLocal } from '../../src/lib/listing.js'

const c = (id, o = {}) => ({ id, status: 'done', name: '', nameKana: '', tags: [], createdAt: '2026-11-01T00:00:00.000Z', ...o })
const cards = [
  c('a', { name: '山田 太郎', nameKana: 'やまだ たろう', companyId: 'co1', tags: ['khách hàng'], createdAt: '2026-11-20T03:00:00.000Z' }),
  c('b', { name: 'Nguyễn Văn An', companyRaw: 'Công ty CP Minh Phát', tags: ['đối tác', 'khách hàng'], createdAt: '2026-10-05T03:00:00.000Z' }),
  c('c', { status: 'pending', createdAt: '2026-11-21T03:00:00.000Z' }),
  c('d', { name: '田中 花子', nameKana: 'たなか はなこ', companyId: 'co1', title: '部長', createdAt: '2026-10-01T03:00:00.000Z' })
]
const names = { co1: 'ABC商事株式会社' }
const companyName = x => names[x.companyId] || ''
const ids = list => list.map(x => x.id)

describe('filterCards', () => {
  it('chips: all, pending, tag', () => {
    expect(ids(filterCards(cards))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(filterCards(cards, { chip: 'pending' }))).toEqual(['c'])
    expect(ids(filterCards(cards, { chip: 'tag:khách hàng' }))).toEqual(['a', 'b'])
    expect(ids(filterCards(cards, { chip: 'tag:none' }))).toEqual([])
  })
  it('searches names, kana, company name (from companies), title; accent-insensitive; every word', () => {
    expect(ids(filterCards(cards, { q: 'abc商事', companyName }))).toEqual(['a', 'd'])
    expect(ids(filterCards(cards, { q: 'nguyen an' }))).toEqual(['b'])
    expect(ids(filterCards(cards, { q: 'たなか' }))).toEqual(['d'])
    expect(ids(filterCards(cards, { q: '部長 abc', companyName }))).toEqual(['d'])
    expect(ids(filterCards(cards, { q: 'minh phat', chip: 'tag:đối tác' }))).toEqual(['b'])
    expect(ids(filterCards(cards, { q: 'ＡＢＣ', companyName }))).toEqual(['a', 'd'])
  })
  it('ignores spaces inside names', () => {
    expect(ids(filterCards(cards, { q: '山田太郎' }))).toEqual(['a'])
    expect(ids(filterCards(cards, { q: 'やまだたろう' }))).toEqual(['a'])
    expect(ids(filterCards(cards, { q: 'nguyenvanan' }))).toEqual(['b'])
  })
})

describe('sortCards', () => {
  it('newest first by createdAt', () => {
    expect(ids(sortCards(cards))).toEqual(['c', 'a', 'b', 'd'])
  })
  it('by name (kana reading), empty names last', () => {
    expect(ids(sortCards(cards, 'name'))).toEqual(['b', 'd', 'a', 'c'])
  })
  it('by company, then name; no company last', () => {
    expect(ids(sortCards(cards, 'company', companyName))).toEqual(['d', 'a', 'b', 'c'])
  })
  it('does not mutate the input', () => {
    const copy = [...cards]
    sortCards(cards, 'name')
    expect(cards).toEqual(copy)
  })
})

it('groupByMonth groups consecutive months', () => {
  const g = groupByMonth(sortCards(cards))
  expect(g.map(x => [x.key, ids(x.items)])).toEqual([['2026-11', ['c', 'a']], ['2026-10', ['b', 'd']]])
})

it('cardTags: most used first', () => {
  expect(cardTags(cards)).toEqual(['khách hàng', 'đối tác'])
})

it('date helpers', () => {
  expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  expect(monthKey('bad')).toBe('')
  expect(monthKey(new Date(2026, 10, 30, 23).toISOString())).toBe('2026-11')
})
