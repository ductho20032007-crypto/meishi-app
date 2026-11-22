// tests/lib/merge.test.js
import { it, expect } from 'vitest'
import { merge3 } from '../../src/lib/merge.js'
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
