// src/lib/conflicts.js — turn a db.conflicts row into what the conflict dialog shows.
import { INTERNAL_FIELDS } from './merge.js'

// { deleted: 'remote' | 'local' | null, fields, local, remote }
export function conflictFields(row) {
  const fields = row?.fields || []
  const deleted = fields.includes('*deleted') ? 'remote' : fields.includes('*deleted-local') ? 'local' : null
  return { deleted, fields: deleted ? [] : fields.filter(f => !f.startsWith('*') && !INTERNAL_FIELDS.includes(f)), local: row?.local || null, remote: row?.remote || null }
}

const MAX = 160
const clip = s => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s)

// i18n key of a field label for a card / company record
export function fieldKey(field, isCompany = false) {
  if (field === 'companyId') return 'field.company'
  if (isCompany && field === 'name') return 'field.companyName'
  return `field.${field}`
}

// Human readable value of one field.
// opts: empty / image texts, phoneType(type), companyName(id), personName(id), rankLabel(n)
export function formatValue(field, v, { empty = '—', image = '[image]', phoneType = x => x, companyName = x => x, personName = x => x, rankLabel = x => String(x) } = {}) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return empty
  if (field === 'companyId') return companyName(v)
  if (field === 'reportsTo') return personName(v)
  if (field === 'rank' && typeof v === 'number') return rankLabel(v)
  if (field === 'deptAliases' && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).map(([a, b]) => `${a} → ${b}`).join('\n') || empty
  if (field === 'deptPath' && Array.isArray(v)) return v.join(' › ')
  if (field === 'phones' && Array.isArray(v)) return v.map(p => `${phoneType(p?.type)} ${p?.value ?? ''}`.trim()).join('\n')
  if (field === 'tags' && Array.isArray(v)) return v.map(x => `#${x}`).join(' ')
  if (field === 'placeholders' && Array.isArray(v)) return v.map(p => p?.name || '?').join(', ')
  if (typeof v === 'string') return v.startsWith('data:image/') ? image : clip(v)
  if (Array.isArray(v) && v.every(x => typeof x !== 'object' || x === null)) return clip(v.join(', '))
  if (typeof v === 'object') return clip(JSON.stringify(v))
  return String(v)
}
