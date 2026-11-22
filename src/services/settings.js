const K = { gh: 'meishi.gh', repo: 'meishi.repo', gk: 'meishi.gk', model: 'meishi.model', lang: 'meishi.lang' }
const get = k => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }
export const DEFAULT_MODEL = 'gemini-flash-latest'
export function getConfig() {
  return { gh: get(K.gh), repo: get(K.repo), gk: get(K.gk), model: get(K.model) || DEFAULT_MODEL, lang: get(K.lang) }
}
export const hasKeys = () => !!(get(K.gh) && get(K.repo) && get(K.gk))
export function saveKeys({ gh, repo, gk }) { set(K.gh, gh); set(K.repo, repo); set(K.gk, gk) }
export function clearKeys() { set(K.gh, null); set(K.repo, null); set(K.gk, null) }
export function setPref(name, value) { set(K[name], value) }
