// src/lib/csv.js
const COLS = ['name', 'nameKana', 'nameLatin', 'company', 'dept', 'title', 'rank', 'phones', 'emails', 'address', 'website', 'tags', 'metAt', 'metPlace', 'memo']
const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
export function toCsv(cards, companyNameById) {
  const rows = cards.map(c => [c.name, c.nameKana, c.nameLatin, companyNameById[c.id] ?? '', (c.deptPath || []).join(' / '),
    c.title, c.rank, (c.phones || []).map(p => `${p.type}:${p.value}`).join(' | '), (c.emails || []).join(' | '), c.address,
    c.website, (c.tags || []).join(' | '), c.metAt, c.metPlace, c.memo].map(q).join(','))
  return '\uFEFF' + [COLS.join(','), ...rows].join('\r\n') + '\r\n'
}
