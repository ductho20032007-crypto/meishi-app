// src/lib/vcard.js
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
const TEL = { mobile: 'CELL', office: 'WORK', fax: 'FAX' }
export function toVCard(card, companyName = '') {
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(card.name)}`, `N:${esc(card.name)};;;;`]
  if (card.nameKana) L.push(`X-PHONETIC-FIRST-NAME:${esc(card.nameKana)}`)
  if (companyName || card.deptPath?.length) L.push(`ORG:${esc(companyName)};${esc((card.deptPath || []).join(' '))}`)
  if (card.title) L.push(`TITLE:${esc(card.title)}`)
  for (const p of card.phones || []) L.push(`TEL;TYPE=${TEL[p.type] || 'VOICE'}:${p.value}`)
  for (const e of card.emails || []) L.push(`EMAIL;TYPE=INTERNET:${e}`)
  if (card.address) L.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`)
  if (card.website) L.push(`URL:${card.website}`)
  if (card.memo) L.push(`NOTE:${esc(card.memo)}`)
  L.push('END:VCARD')
  return L.join('\r\n') + '\r\n'
}
export const toVCards = (cards, companyNameOf) => cards.map(c => toVCard(c, companyNameOf(c))).join('')
