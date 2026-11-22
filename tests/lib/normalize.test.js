import { describe, it, expect } from 'vitest'
import { normalizeCompany, matchCompany, searchKey, normalizeDept } from '../../src/lib/normalize.js'
describe('normalizeCompany', () => {
  it.each([
    ['株式会社ABC商事', 'abc商事'], ['ABC商事株式会社', 'abc商事'], ['㈱ＡＢＣ商事', 'abc商事'], ['(株)ABC商事', 'abc商事'],
    ['ABC Shoji Co., Ltd.', 'abcshoji'], ['Sakura Inc.', 'sakura'], ['Công ty CP Minh Phát', 'minhphát'],
    ['Công ty TNHH Sông Hồng Tech', 'sônghồngtech'], ['Minh Phát JSC', 'minhphát']
  ])('%s → %s', (a, b) => expect(normalizeCompany(a)).toBe(b))
})
describe('matchCompany', () => {
  const cs = [{ id: 'c-1', name: 'ABC商事株式会社', aliases: ['ABC Shoji Co., Ltd.'] }]
  it('matches by name and alias', () => {
    expect(matchCompany('株式会社ABC商事', cs)?.id).toBe('c-1')
    expect(matchCompany('ABC SHOJI', cs)?.id).toBe('c-1')
  })
  it('returns null for empty / unknown', () => {
    expect(matchCompany('', cs)).toBeNull()
    expect(matchCompany('XYZ', cs)).toBeNull()
  })
})
it('searchKey ignores case, width and Vietnamese accents', () => {
  expect(searchKey('Trưởng PHÒNG')).toBe(searchKey('truong phong'))
  expect(searchKey('ＡＢＣ')).toBe('abc')
})
it('normalizeDept trims and unifies width', () => expect(normalizeDept(' 第１営業部 ')).toBe('第1営業部'))
