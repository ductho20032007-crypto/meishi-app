import { describe, it, expect } from 'vitest'
import { utf8ToB64, b64ToUtf8, toB64url, fromB64url, bytesToB64, b64ToBytes } from '../../src/lib/b64.js'
describe('b64', () => {
  it('round-trips unicode', () => {
    const s = '山田 太郎 · Trưởng phòng'
    expect(b64ToUtf8(utf8ToB64(s))).toBe(s)
  })
  it('accepts GitHub base64 with newlines', () => {
    expect(b64ToUtf8(utf8ToB64('abc').replace(/(.{2})/, '$1\n'))).toBe('abc')
  })
  it('base64url has no + / =', () => {
    const u = toB64url('??>>~~')
    expect(u).not.toMatch(/[+/=]/)
    expect(fromB64url(u)).toBe('??>>~~')
  })
  it('round-trips 100 KB of bytes', () => {
    const b = new Uint8Array(100 * 1024)
    for (let i = 0; i < b.length; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536))
    expect(b64ToBytes(bytesToB64(b))).toEqual(b)
  })
})
