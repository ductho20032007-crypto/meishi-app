// tests/lib/setupLink.test.js
import { it, expect } from 'vitest'
import { encodeSetup, decodeSetup, buildSetupUrl } from '../../src/lib/setupLink.js'
const cfg = { gh: 'github_pat_abc', repo: 'me/meishi-data', gk: 'AQ.xyz' }
it('round-trips', () => expect(decodeSetup(encodeSetup(cfg))).toEqual(cfg))
it('rejects garbage', () => {
  expect(() => decodeSetup('!!!')).toThrow()
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: 'bad' }))).toThrow()
})
it('builds hash url', () => {
  expect(buildSetupUrl('https://x.github.io/meishi-app/', cfg)).toMatch(/^https:\/\/x\.github\.io\/meishi-app\/#\/setup\?c=[\w-]+$/)
})
it('trims values', () => {
  expect(decodeSetup(encodeSetup({ gh: 'github_pat_abc\r', repo: ' me/meishi-data\n', gk: 'AQ.xyz ' }))).toEqual(cfg)
})
it('rejects path-like repo', () => {
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: '../x' }))).toThrow()
  expect(() => decodeSetup(encodeSetup({ ...cfg, repo: 'me/..' }))).toThrow()
})
