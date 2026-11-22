// src/lib/setupLink.js
import { toB64url, fromB64url } from './b64.js'
export function encodeSetup({ gh, repo, gk }) { return toB64url(JSON.stringify({ v: 1, gh: gh.trim(), repo: repo.trim(), gk: gk.trim() })) }
export function decodeSetup(c) {
  let o
  try { o = JSON.parse(fromB64url(c)) } catch { throw new Error('invalid_setup') }
  if (o?.v !== 1 || typeof o.gh !== 'string' || typeof o.gk !== 'string' || typeof o.repo !== 'string') throw new Error('invalid_setup')
  const gh = o.gh.trim(), repo = o.repo.trim(), gk = o.gk.trim()
  if (!gh || !gk || !/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(repo)) throw new Error('invalid_setup')
  return { gh, repo, gk }
}
export const buildSetupUrl = (base, cfg) => `${base.replace(/\/?$/, '/')}#/setup?c=${encodeSetup(cfg)}`
