const LEGAL = [
  /株式会社/g, /有限会社/g, /合同会社/g, /\(株\)/g, /\(有\)/g,
  /co\.?,?\s*ltd\.?/gi, /\bltd\.?/gi, /\binc\.?/gi, /\bcorp(oration)?\.?/gi, /\bjsc\b/gi, /\bllc\b/gi,
  /công ty\s+(tnhh|cổ phần|cp)(\s+(một thành viên|mtv))?/gi, /^công ty\s+/gi
]
export function normalizeCompany(name) {
  let s = (name || '').normalize('NFKC').toLowerCase()
  for (const re of LEGAL) s = s.replace(re, ' ')
  return s.replace(/[\s.,・·\-_'"()&]/g, '')
}
export function matchCompany(raw, companies) {
  const n = normalizeCompany(raw)
  if (!n) return null
  return companies.find(c => [c.name, ...(c.aliases || [])].some(a => normalizeCompany(a) === n)) || null
}
export const normalizeDept = s => (s || '').normalize('NFKC').trim().replace(/\s+/g, '')
export function searchKey(s) {
  return (s || '').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()
}
export function cardSearchText(card, companyName = '') {
  return searchKey([card.name, card.nameKana, card.nameLatin, companyName, card.companyRaw, ...(card.deptPath || []),
    card.title, ...(card.emails || []), ...(card.tags || []), card.memo, card.metPlace].filter(Boolean).join(' '))
}
