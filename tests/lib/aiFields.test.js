import { it, expect, describe } from 'vitest'
import { aiFilled, aiItem, aiCompany, resetAiFields, diffPatch, sameValue, isEmptyValue } from '../../src/lib/aiFields.js'

const snap = { name: '山田 太郎', nameKana: '', nameLatin: '', companyRaw: '株式会社ABC商事', deptPath: ['営業本部', '第一営業部'], title: '課長', rank: 5,
  phones: [{ type: 'mobile', value: '090-1' }, { type: 'office', value: '03-1' }], emails: ['a@x.jp'], address: '東京', website: '' }
const card = { ocrBy: 'gemini', ocrSnapshot: snap, ...structuredClone(snap), memo: '' }

describe('sameValue / isEmptyValue', () => {
  it('treats null, undefined and blank strings alike; compares arrays and objects structurally', () => {
    expect(sameValue(null, '')).toBe(true)
    expect(sameValue(' a ', 'a')).toBe(true)
    expect(sameValue({ value: '1', type: 'm' }, { type: 'm', value: '1' })).toBe(true)
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameValue(5, '5')).toBe(false)
    expect(isEmptyValue([])).toBe(true)
    expect(isEmptyValue(' ')).toBe(true)
    expect(isEmptyValue(0)).toBe(false)
  })
})

describe('aiFilled', () => {
  it('is true for unchanged non-empty OCR values only', () => {
    expect(aiFilled(card, 'name')).toBe(true)
    expect(aiFilled(card, 'deptPath')).toBe(true)
    expect(aiFilled(card, 'rank')).toBe(true)
    expect(aiFilled(card, 'nameKana')).toBe(false)          // OCR returned nothing
    expect(aiFilled(card, 'title', '部長')).toBe(false)     // edited
    expect(aiFilled(card, 'deptPath', ['営業本部'])).toBe(false)
    expect(aiFilled(card, 'memo')).toBe(false)              // not an OCR field
  })
  it('is false for manual / pending cards or without a snapshot', () => {
    expect(aiFilled({ ...card, ocrBy: 'manual' }, 'name')).toBe(false)
    expect(aiFilled({ ...card, ocrSnapshot: undefined }, 'name')).toBe(false)
    expect(aiFilled(null, 'name')).toBe(false)
  })
  it('aiItem matches single phone / email entries', () => {
    expect(aiItem(card, 'phones', { type: 'mobile', value: '090-1' })).toBe(true)
    expect(aiItem(card, 'phones', { type: 'fax', value: '090-1' })).toBe(false)
    expect(aiItem(card, 'emails', 'a@x.jp')).toBe(true)
    expect(aiItem(card, 'emails', '')).toBe(false)
  })
  it('aiCompany matches the selected company by name or alias', () => {
    expect(aiCompany(card, { name: 'ABC商事', aliases: [] })).toBe(true)
    expect(aiCompany(card, { name: 'XYZ', aliases: ['ABC商事株式会社'] })).toBe(true)
    expect(aiCompany(card, { name: 'XYZ', aliases: [] })).toBe(false)
    expect(aiCompany(card, null)).toBe(false)
  })
})

it('resetAiFields empties only untouched OCR values', () => {
  const edited = { ...card, title: '部長', phones: [{ type: 'mobile', value: '080-9' }] }
  expect(resetAiFields(edited)).toEqual({ name: '', companyRaw: '', deptPath: [], rank: null, emails: [], address: '' })
  expect(resetAiFields({ ...card, ocrBy: null })).toEqual({})
})

it('diffPatch returns only changed fields', () => {
  const a = { name: 'A', deptPath: ['x'], rank: null, memo: '' }
  expect(diffPatch(a, { name: 'A', deptPath: ['x'], rank: null, memo: ' ' })).toEqual({})
  expect(diffPatch(a, { name: 'B', deptPath: ['x', 'y'], rank: 5, memo: '' })).toEqual({ name: 'B', deptPath: ['x', 'y'], rank: 5 })
  expect(diffPatch(a, { name: 'B', memo: 'm' }, ['memo'])).toEqual({ memo: 'm' })
})
