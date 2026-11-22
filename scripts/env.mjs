// scripts/env.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export function parseEnv(text) {
  const env = {}
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    const q = v.match(/^(['"])(.*?)\1/)
    v = q ? q[2] : v.replace(/\s+#.*$/, '').trim()
    env[m[1]] = v
  }
  return env
}
export function loadEnv(file = new URL('../.env.local', import.meta.url), required = ['MEISHI_GITHUB_TOKEN', 'MEISHI_GITHUB_REPO', 'MEISHI_GEMINI_KEY']) {
  let text
  try { text = readFileSync(file, 'utf8') }
  catch (e) { throw new Error(`Cannot read env file ${file instanceof URL ? fileURLToPath(file) : file}: ${e.code || e.message}`) }
  const env = parseEnv(text)
  for (const k of required) if (!env[k]) throw new Error(`${k} missing in .env.local`)
  return env
}
