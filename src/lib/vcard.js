// src/lib/vcard.js
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1')
const raw = s => String(s ?? '').replace(/[\r\n]+/g, '')
const TEL = { mobile: 'CELL', office: 'WORK', fax: 'WORK,FAX' }
const splitName = s => {
  const t = String(s ?? '').trim()
  const i = t.search(/[ \u3000]/)
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1).trim()]
}
export function toVCard(card, companyName = '') {
  const [fam, giv] = splitName(card.name)
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(card.name)}`, `N:${esc(fam)};${esc(giv)};;;`]
  if (card.nameKana) {
    const [kf, kg] = splitName(card.nameKana)
    L.push(`X-PHONETIC-LAST-NAME:${esc(kf)}`)
    if (kg) L.push(`X-PHONETIC-FIRST-NAME:${esc(kg)}`)
  }
  if (companyName || card.deptPath?.length) L.push(['ORG:' + esc(companyName), ...(card.deptPath || []).map(esc)].join(';'))
  if (card.title) L.push(`TITLE:${esc(card.title)}`)
  for (const p of card.phones || []) L.push(`TEL;TYPE=${TEL[p.type] || 'VOICE'}:${raw(p.value)}`)
  for (const e of card.emails || []) L.push(`EMAIL;TYPE=INTERNET:${raw(e)}`)
  if (card.address) L.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`)
  if (card.website) L.push(`URL:${raw(card.website)}`)
  if (card.memo) L.push(`NOTE:${esc(card.memo)}`)
  L.push('END:VCARD')
  return L.join('\r\n') + '\r\n'
}
export const toVCards = (cards, companyNameOf) => cards.map(c => toVCard(c, companyNameOf(c))).join('')
