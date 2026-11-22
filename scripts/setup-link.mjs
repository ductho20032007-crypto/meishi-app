import QRCode from 'qrcode'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './env.mjs'
import { buildSetupUrl } from '../src/lib/setupLink.js'
const env = loadEnv()
const args = process.argv.slice(2)
const base = args.find(a => !a.startsWith('--')) || `https://${env.MEISHI_GITHUB_REPO.split('/')[0]}.github.io/meishi-app/`
const url = buildSetupUrl(base, { gh: env.MEISHI_GITHUB_TOKEN, repo: env.MEISHI_GITHUB_REPO, gk: env.MEISHI_GEMINI_KEY })
await QRCode.toFile(fileURLToPath(new URL('../setup-qr.png', import.meta.url)), url, { width: 600, margin: 2 })
console.log('Setup QR saved to setup-qr.png (contains secrets — do not share).')
if (args.includes('--print')) console.log(url)
