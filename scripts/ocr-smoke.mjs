import { readFileSync, readdirSync } from 'node:fs'
import { loadEnv } from './env.mjs'
import { createGemini } from '../src/services/gemini.js'
const env = loadEnv()
const g = createGemini({ key: env.MEISHI_GEMINI_KEY, model: process.argv[2] || 'gemini-flash-latest' })
const dir = new URL('../tests/fixtures/cards/', import.meta.url)
for (const f of readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f))) {
  const data = readFileSync(new URL(f, dir)).toString('base64')
  const t0 = Date.now()
  const r = await g.extract([{ mimeType: f.endsWith('.png') ? 'image/png' : 'image/jpeg', data }])
  console.log(`\n== ${f} (${Date.now() - t0} ms)\n` + JSON.stringify(r, null, 2))
}
