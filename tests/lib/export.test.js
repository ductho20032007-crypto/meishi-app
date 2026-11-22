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
  expect(v).toContain('ORG:ABC商事;営業本部;第一営業部')
  expect(v).toContain('N:山田;太郎;;;')
  expect(v).toContain('X-PHONETIC-LAST-NAME:やまだ')
  expect(v).toContain('X-PHONETIC-FIRST-NAME:たろう')
  expect(v).toContain('TEL;TYPE=CELL:090-1')
  expect(v).toContain('TEL;TYPE=WORK:03-2')
  expect(v).toContain('ADR;TYPE=WORK:;;東京\\, 千代田;;;;')
  expect(v).toContain('NOTE:m\\;x')
  expect(v.endsWith('END:VCARD\r\n')).toBe(true)
})
it('vcard: fax type, no-space name, no line injection', () => {
  const v = toVCard({ ...card, name: '山田', nameKana: 'やまだ', phones: [{ type: 'fax', value: '03-9' }, { type: 'office', value: '1\nEND:VCARD\nFN:x' }], memo: 'a\r\nb' }, 'X')
  expect(v).toContain('TEL;TYPE=WORK,FAX:03-9')
  expect(v).toContain('N:山田;;;;')
  expect(v).toContain('X-PHONETIC-LAST-NAME:やまだ')
  expect(v).not.toContain('X-PHONETIC-FIRST-NAME')
  expect(v).toContain('NOTE:a\\nb')
  expect(v.split('\r\n').filter(l => l === 'END:VCARD')).toHaveLength(1)
  expect(v.split('\r\n')).not.toContain('FN:x')
})
it('csv with BOM and quoting', () => {
  const c = toCsv([card], () => 'ABC "商事"')
  expect(c.startsWith('﻿')).toBe(true)
  expect(c).toContain('"ABC ""商事"""')
})
it('csv neutralises formulas and falls back to companyRaw', () => {
  const c = toCsv([{ ...card, name: '=HYPERLINK(1)', nameKana: '+1', nameLatin: '@SUM(1)', companyRaw: 'Raw Co' }], () => '')
  expect(c).toContain('"\'=HYPERLINK(1)"')
  expect(c).toContain('"\'+1"')
  expect(c).toContain('"\'@SUM(1)"')
  expect(c).toContain('"Raw Co"')
})
