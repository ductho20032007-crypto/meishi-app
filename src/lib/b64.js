export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function b64ToUtf8(b64) { return new TextDecoder().decode(b64ToBytes(b64)) }
export function bytesToB64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function toB64url(str) { return utf8ToB64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
export function fromB64url(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  return b64ToUtf8(b + '='.repeat((4 - (b.length % 4)) % 4))
}
export async function blobToB64(blob) { return bytesToB64(new Uint8Array(await blob.arrayBuffer())) }
export function b64ToBlob(b64, type = 'image/jpeg') { return new Blob([b64ToBytes(b64)], { type }) }
