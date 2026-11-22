import { describe, it, expect } from 'vitest'
import { matchTitle, rankFor } from '../../src/lib/rank.js'
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
  it('dictionary has 41 entries across ranks 1..7', () => {
    expect(TITLES).toHaveLength(41)
    expect(new Set(TITLES.map(t => t.rank))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
  })
})
