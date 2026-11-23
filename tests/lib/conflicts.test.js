import { it, expect } from 'vitest'
import { conflictFields, formatValue } from '../../src/lib/conflicts.js'

it('conflictFields: field list, remote / local deletion', () => {
  const local = { name: 'A' }, remote = { name: 'B' }
  expect(conflictFields({ fields: ['name', 'memo'], local, remote })).toEqual({ deleted: null, fields: ['name', 'memo'], local, remote })
  expect(conflictFields({ fields: ['*deleted'], local, remote: null })).toMatchObject({ deleted: 'remote', fields: [] })
  expect(conflictFields({ fields: ['*deleted-local'], local: null, remote })).toMatchObject({ deleted: 'local', fields: [] })
  expect(conflictFields(null)).toEqual({ deleted: null, fields: [], local: null, remote: null })
})

it('formatValue renders each field kind', () => {
  const o = { empty: '(empty)', phoneType: t => ({ mobile: 'Mobile' })[t] || t, companyName: id => (id === 'c1' ? 'ABC' : id) }
  expect(formatValue('memo', '', o)).toBe('(empty)')
  expect(formatValue('emails', [], o)).toBe('(empty)')
  expect(formatValue('companyId', 'c1', o)).toBe('ABC')
  expect(formatValue('deptPath', ['営業本部', '第一営業部'], o)).toBe('営業本部 › 第一営業部')
  expect(formatValue('phones', [{ type: 'mobile', value: '090' }, { type: 'fax', value: '03' }], o)).toBe('Mobile 090\nfax 03')
  expect(formatValue('tags', ['a', 'b'], o)).toBe('#a #b')
  expect(formatValue('emails', ['a@x', 'b@x'], o)).toBe('a@x, b@x')
  expect(formatValue('rank', 5, o)).toBe('5')
  expect(formatValue('thumb', 'data:image/jpeg;base64,xx', o)).toBe('[image]')
  expect(formatValue('memo', 'x'.repeat(300), o)).toHaveLength(160)
  expect(formatValue('ocrSnapshot', { a: 1 }, o)).toBe('{"a":1}')
})
