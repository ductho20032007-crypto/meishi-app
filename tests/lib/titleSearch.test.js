import { it, expect } from 'vitest'
import { searchTitles, groupByRank, TITLE_COUNT } from '../../src/lib/titleSearch.js'
import { TITLES } from '../../src/data/titles.js'

const ja = list => list.map(e => e.ja)

it('empty query returns every entry', () => {
  expect(searchTitles('')).toHaveLength(TITLES.length)
  expect(searchTitles('   ')).toHaveLength(TITLE_COUNT)
})
it('matches Japanese, also width / space insensitive', () => {
  expect(ja(searchTitles('課長'))).toEqual(['課長', '課長代理'])
  expect(ja(searchTitles('課 長'))).toEqual(['課長', '課長代理'])
})
it('matches the reading', () => {
  expect(ja(searchTitles('かちょう'))).toContain('課長')
})
it('matches Vietnamese without accents and English case-insensitively', () => {
  expect(ja(searchTitles('truong phong'))).toContain('部長')
  expect(ja(searchTitles('Trưởng phòng'))).toContain('部長')
  expect(ja(searchTitles('SECTION MANAGER'))).toEqual(expect.arrayContaining(['課長', '課長代理']))
  expect(ja(searchTitles('ｓｅｃｔｉｏｎ'))).toContain('課長')
})
it('no match -> empty', () => {
  expect(searchTitles('zzzz')).toEqual([])
})
it('groups by rank ascending, keeping entry order', () => {
  const g = groupByRank(searchTitles(''))
  expect(g.map(x => x.rank)).toEqual([...new Set(TITLES.map(e => e.rank))].sort())
  expect(g[0].items[0]).toBe(TITLES.find(e => e.rank === 1))
  expect(groupByRank(searchTitles('課長')).map(x => x.rank)).toEqual([5])
  expect(groupByRank([])).toEqual([])
})
