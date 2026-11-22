// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnv, parseEnv } from '../../scripts/env.mjs'

const tmp = text => {
  const dir = mkdtempSync(join(tmpdir(), 'meishi-env-'))
  const f = join(dir, '.env.local')
  writeFileSync(f, text)
  return { f, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const REQ = ['A', 'B']

describe('env loader', () => {
  it('handles BOM, CRLF, export, spaces, quotes and comments', () => {
    const t = tmp('﻿A = one # trailing\r\nexport B="two # kept"\r\n# comment\r\nC=\'three\'\r\nD=x#notcomment\r\n')
    try {
      expect(loadEnv(t.f, REQ)).toEqual({ A: 'one', B: 'two # kept', C: 'three', D: 'x#notcomment' })
    } finally { t.done() }
  })
  it('reports a missing required key by name only', () => {
    const t = tmp('A=1\n')
    try { expect(() => loadEnv(t.f, REQ)).toThrow('B missing in .env.local') } finally { t.done() }
  })
  it('gives a clear error for a missing file', () => {
    expect(() => loadEnv(join(tmpdir(), 'meishi-nope', '.env.local'), REQ)).toThrow(/Cannot read env file .*ENOENT/)
  })
  it('parseEnv ignores garbage lines', () => {
    expect(parseEnv('foo\n=bar\nlower=1\nX=2')).toEqual({ X: '2' })
  })
})
