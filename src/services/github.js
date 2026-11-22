// src/services/github.js
export class GitHubError extends Error {
  constructor(kind, status, message, resetAt = null) { super(message); this.kind = kind; this.status = status; this.resetAt = resetAt }
}
export function createGitHub({ token, repo, fetch = globalThis.fetch.bind(globalThis) }) {
  const base = `https://api.github.com/repos/${repo}`
  async function call(path, init = {}) {
    let r
    try {
      r = await fetch(base + path, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
    } catch (e) { throw new GitHubError('network', 0, e.message) }
    if (r.ok) return r.status === 204 ? null : r.json()
    const body = await r.json().catch(() => ({}))
    const msg = body.message || r.statusText
    const retryAfter = r.headers.get('retry-after'), reset = r.headers.get('x-ratelimit-reset')
    const limited = r.status === 429 || (r.status === 403 &&
      (retryAfter != null || r.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse/i.test(msg)))
    if (limited) {
      const resetAt = retryAfter != null ? Date.now() + Number(retryAfter) * 1000 : reset ? Number(reset) * 1000 : Date.now() + 60000
      throw new GitHubError('ratelimit', r.status, msg, resetAt)
    }
    const kind = { 401: 'auth', 403: 'auth', 404: 'notfound', 409: 'conflict', 422: 'conflict' }[r.status] || 'other'
    throw new GitHubError(kind, r.status, msg)
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/')
  return {
    ping: () => call(''),
    async getTree() {
      let t
      try { t = await call('/git/trees/HEAD?recursive=1') }
      catch (e) { if (e instanceof GitHubError && (e.status === 409 || /empty/i.test(e.message))) return []; throw e }   // empty repo
      if (t.truncated) throw new GitHubError('other', 200, 'tree truncated')
      return t.tree.filter(e => e.type === 'blob').map(({ path, sha }) => ({ path, sha }))
    },
    async getBlob(sha) { return (await call(`/git/blobs/${sha}`)).content },          // base64
    async getFile(path) { const f = await call(`/contents/${enc(path)}`); return { sha: f.sha, content: f.content } },
    async putFile(path, contentB64, sha, message = `update ${path}`) {
      const r = await call(`/contents/${enc(path)}`, { method: 'PUT', body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }) })
      return r.content.sha
    },
    async deleteFile(path, sha, message = `delete ${path}`) {
      await call(`/contents/${enc(path)}`, { method: 'DELETE', body: JSON.stringify({ message, sha }) })
    }
  }
}
