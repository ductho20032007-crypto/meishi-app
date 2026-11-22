// scripts/env.mjs
import { readFileSync } from 'node:fs'
export function loadEnv(file = new URL('../.env.local', import.meta.url)) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
  }
  for (const k of ['MEISHI_GITHUB_TOKEN', 'MEISHI_GITHUB_REPO', 'MEISHI_GEMINI_KEY']) if (!env[k]) throw new Error(`${k} missing in .env.local`)
  return env
}
