import { describe, it, expect } from 'vitest'
import { matchTitle, rankFor, viFor } from '../../src/lib/rank.js'
import { TITLES } from '../../src/data/titles.js'
describe('matchTitle', () => {
  it.each([
    ['部長', 4, 'Trưởng phòng'],
    ['営業部長', 4, 'Trưởng phòng'],
    ['代表取締役社長', 1, 'Tổng giám đốc, người đại diện pháp luật'],
    ['課長代理', 5, 'Quyền trưởng ban / Phó ban'],
    ['取締役営業本部長', 2, 'Thành viên HĐQT'],
    ['第一営業部 課長', 5, 'Trưởng ban / Trưởng bộ phận']
  ])('%s', (t, rank, vi) => {
    const m = matchTitle(t)
    expect(m.rank).toBe(rank)
    expect(m.entry.vi).toBe(vi)
  })
  it.each([
    ['Vice President', 2], ['CEO', 1], ['Trưởng phòng Kinh doanh', 4], ['Phó tổng giám đốc', 2],
    ['Sales Manager', 5], ['Senior Manager', 4], ['Engineer', 7], ['', 7], [null, 7], ['Team Leader', 6]
  ])('fallback %s', (t, rank) => {
    expect(rankFor(t)).toBe(rank)
  })
  it.each([['Service Manager', 5], ['Chief Technology Officer', 2], ['EVP', 2], ['CTO', 2], ['CEO', 1], ['Chief Executive Officer', 1], ['Phó phòng', 4]])('fallback %s', (t, rank) => {
    expect(rankFor(t)).toBe(rank)
  })
  it('exact English / Vietnamese match returns the entry', () => {
    expect(matchTitle('Managing Director')).toMatchObject({ rank: 2, entry: { ja: '常務取締役' } })
    expect(matchTitle('Trưởng phòng')).toMatchObject({ rank: 4, entry: { ja: '部長' } })
  })
  it.each([
    ['取締役社長', 1, '社長'], ['社長室長', 4, '室長'], ['代表取締役会長', 1, '会長'], ['副社長', 2, '副社長']
  ])('JA tie-break %s', (t, rank, ja) => {
    expect(matchTitle(t)).toMatchObject({ rank, entry: { ja } })
  })
  it.each([['次長兼課長', 4, '次長'], ['部長兼課長', 4, '部長']])('concurrent post %s', (t, rank, ja) => {
    expect(matchTitle(t)).toMatchObject({ rank, entry: { ja } })
  })
  it('deputy prefix lowers rank by one', () => {
    expect(matchTitle('副部長')).toEqual({ entry: null, rank: 5 })
  })
  it('viFor', () => {
    expect(viFor('課長')).toBe('Trưởng ban / Trưởng bộ phận')
    expect(viFor('xyz')).toBeNull()
  })
  it('dictionary has 41 entries across ranks 1..7', () => {
    expect(TITLES).toHaveLength(41)
    expect(new Set(TITLES.map(t => t.rank))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
  })
})
