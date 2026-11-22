// src/lib/csv.js
const COLS = ['name', 'nameKana', 'nameLatin', 'company', 'dept', 'title', 'rank', 'phones', 'emails', 'address', 'website', 'tags', 'metAt', 'metPlace', 'memo']
// neutralise spreadsheet formula injection, then quote
const q = v => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}
export function toCsv(cards, companyNameOf = () => '') {
  const rows = cards.map(c => [c.name, c.nameKana, c.nameLatin, companyNameOf(c) || c.companyRaw || '', (c.deptPath || []).join(' / '),
    c.title, c.rank, (c.phones || []).map(p => `${p.type}:${p.value}`).join(' | '), (c.emails || []).join(' | '), c.address,
    c.website, (c.tags || []).join(' | '), c.metAt, c.metPlace, c.memo].map(q).join(','))
  return '\uFEFF' + [COLS.join(','), ...rows].join('\r\n') + '\r\n'
}
