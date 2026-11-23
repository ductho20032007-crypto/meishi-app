// tests/lib/merge.test.js
import { it, expect, describe } from 'vitest'
import { merge3, mergeRecords } from '../../src/lib/merge.js'
const base = { id: 'a', name: 'A', memo: '', tags: [], updatedAt: '1' }
it('takes non-overlapping changes from both sides', () => {
  const r = merge3(base, { ...base, memo: 'local', updatedAt: '2' }, { ...base, tags: ['x'], updatedAt: '3' })
  expect(r.conflicts).toEqual([])
  expect(r.merged).toMatchObject({ memo: 'local', tags: ['x'], updatedAt: '3' })
})
it('reports same-field conflicts', () => {
  const r = merge3(base, { ...base, name: 'L' }, { ...base, name: 'R' })
  expect(r.conflicts).toEqual(['name'])
})
it('no base: identical fields fine, differing fields conflict', () => {
  expect(merge3(null, { a: 1, b: 2 }, { a: 1, b: 3 }).conflicts).toEqual(['b'])
})
it('unions tags when both sides changed', () => {
  const r = merge3(base, { ...base, tags: ['a', 'b'] }, { ...base, tags: ['b', 'c'] })
  expect(r.conflicts).toEqual([])
  expect(r.merged.tags).toEqual(['a', 'b', 'c'])
})
it('tags union respects deletions relative to base', () => {
  const r = merge3({ ...base, tags: ['a'] }, { ...base, tags: ['b'] }, { ...base, tags: ['a', 'c'] })
  expect(r.conflicts).toEqual([])
  expect(r.merged.tags).toEqual(['b', 'c'])
})

describe('mergeRecords (internal fields auto-resolved)', () => {
  const b = { id: 'a', name: 'A', status: 'pending', ocrBy: null, ocrError: 'quota', ocrSnapshot: null, thumb: '', hasBack: false, createdAt: '1', updatedAt: '1' }
  it('takes OCR state from a done remote', () => {
    const r = mergeRecords(b, { ...b, status: 'pending', ocrError: 'busy', rereadFrom: { name: 'x' } }, { ...b, status: 'done', ocrBy: 'gemini', ocrError: null, ocrSnapshot: { name: 'R' } })
    expect(r.conflicts).toEqual([])
    expect(r.merged).toMatchObject({ status: 'done', ocrBy: 'gemini', ocrError: null, ocrSnapshot: { name: 'R' } })
  })
  it('keeps local OCR state when the remote is not done', () => {
    const r = mergeRecords(b, { ...b, status: 'done', ocrBy: 'gemini', ocrSnapshot: { n: 1 }, ocrError: null }, { ...b, ocrError: 'busy' })
    expect(r.conflicts).toEqual([])
    expect(r.merged).toMatchObject({ status: 'done', ocrBy: 'gemini', ocrSnapshot: { n: 1 }, ocrError: null })
  })
  it('thumb / hasBack prefer non-empty; createdAt never conflicts', () => {
    const r = mergeRecords(b, { ...b, thumb: 'data:l', hasBack: false, createdAt: '0' }, { ...b, thumb: '', hasBack: true, createdAt: '2' })
    expect(r.conflicts).toEqual([])
    expect(r.merged).toMatchObject({ thumb: 'data:l', hasBack: true })
  })
  it('user fields still conflict', () => {
    expect(mergeRecords(b, { ...b, name: 'L' }, { ...b, name: 'R' }).conflicts).toEqual(['name'])
  })
})
