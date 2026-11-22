const A = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function rand(n) {
  const buf = new Uint8Array(n); crypto.getRandomValues(buf)
  return Array.from(buf, b => A[b % A.length]).join('')
}
const pad = n => String(n).padStart(2, '0')
export const newCardId = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand(6)}`
export const newCompanyId = () => `c-${rand(8)}`
export const newPlaceholderId = () => `p-${rand(6)}`
