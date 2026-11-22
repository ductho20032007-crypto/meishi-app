import { describe, it, expect, vi } from 'vitest'
import { createGitHub, GitHubError } from '../../src/services/github.js'
const res = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers })
describe('github client', () => {
  it('lists tree blobs', async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { tree: [{ path: 'cards/a.json', type: 'blob', sha: 's1' }, { path: 'cards', type: 'tree', sha: 't' }] }))
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch })
    expect(await gh.getTree()).toEqual([{ path: 'cards/a.json', sha: 's1' }])
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/me/d/git/trees/HEAD?recursive=1')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })
  it('puts file with sha and returns new sha', async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { content: { sha: 'new' } }))
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch })
    expect(await gh.putFile('cards/a.json', 'Zm9v', 'old')).toBe('new')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/me/d/contents/cards/a.json')
    expect(JSON.parse(init.body)).toMatchObject({ content: 'Zm9v', sha: 'old' })
  })
  it.each([[401, 'auth'], [404, 'notfound'], [409, 'conflict'], [422, 'conflict']])('maps %i → %s', async (s, kind) => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(s, { message: 'x' })) })
    await expect(gh.getTree()).rejects.toMatchObject({ kind })
  })
  it('detects rate limit', async () => {
    const fetch = vi.fn().mockResolvedValue(res(403, { message: 'rate' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }))
    await expect(createGitHub({ token: 't', repo: 'me/d', fetch }).getTree()).rejects.toMatchObject({ kind: 'ratelimit', resetAt: 1800000000000 })
  })
  it('network failure → network', async () => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockRejectedValue(new TypeError('Failed')) })
    await expect(gh.getTree()).rejects.toBeInstanceOf(GitHubError)
  })
})
