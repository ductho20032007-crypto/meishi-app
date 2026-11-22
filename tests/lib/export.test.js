// tests/lib/export.test.js
import { it, expect } from 'vitest'
import { toVCard } from '../../src/lib/vcard.js'
import { toCsv } from '../../src/lib/csv.js'
const card = { id: '1', name: '山田 太郎', nameKana: 'やまだ たろう', title: '課長', deptPath: ['営業本部', '第一営業部'],
  phones: [{ type: 'mobile', value: '090-1' }, { type: 'office', value: '03-2' }], emails: ['a@b.jp'], address: '東京, 千代田', website: '', memo: 'm;x', tags: ['k'] }
it('vcard', () => {
  const v = toVCard(card, 'ABC商事')
  expect(v).toContain('BEGIN:VCARD\r\nVERSION:3.0')
  expect(v).toContain('FN:山田 太郎')
  expect(v).toContain('ORG:ABC商事;営業本部 第一営業部')
  expect(v).toContain('TEL;TYPE=CELL:090-1')
  expect(v).toContain('TEL;TYPE=WORK:03-2')
  expect(v).toContain('ADR;TYPE=WORK:;;東京\\, 千代田;;;;')
  expect(v).toContain('NOTE:m\\;x')
  expect(v.endsWith('END:VCARD\r\n')).toBe(true)
})
it('csv with BOM and quoting', () => {
  const c = toCsv([card], { '1': 'ABC "商事"' })
  expect(c.startsWith('\uFEFF')).toBe(true)
  expect(c).toContain('"ABC ""商事"""')
})
