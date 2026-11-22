// src/lib/setupLink.js
import { toB64url, fromB64url } from './b64.js'
export function encodeSetup({ gh, repo, gk }) { return toB64url(JSON.stringify({ v: 1, gh, repo, gk })) }
export function decodeSetup(c) {
  let o
  try { o = JSON.parse(fromB64url(c)) } catch { throw new Error('invalid_setup') }
  if (o?.v !== 1 || typeof o.gh !== 'string' || !o.gh || typeof o.gk !== 'string' || !o.gk ||
      !/^[\w.-]+\/[\w.-]+$/.test(o.repo || '')) throw new Error('invalid_setup')
  return { gh: o.gh, repo: o.repo, gk: o.gk }
}
export const buildSetupUrl = (base, cfg) => `${base.replace(/\/?$/, '/')}#/setup?c=${encodeSetup(cfg)}`
