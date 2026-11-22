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
  it.each([[401, 'auth'], [403, 'auth'], [422, 'conflict'], [500, 'server'], [502, 'server'], [503, 'server']])('maps %i → %s', async (s, kind) => {
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
  it('409 on put maps to conflict', async () => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(409, { message: 'x' })) })
    await expect(gh.putFile('cards/a.json', 'Zm9v', 'old')).rejects.toMatchObject({ kind: 'conflict' })
  })
  it('empty repo (409 / "empty") gives empty tree', async () => {
    const a = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(409, { message: 'Git Repository is empty.' })) })
    expect(await a.getTree()).toEqual([])
  })
  it('truncated tree is an error', async () => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(200, { tree: [], truncated: true })) })
    await expect(gh.getTree()).rejects.toMatchObject({ kind: 'other' })
  })
  it('sends cache: no-store', async () => {
    const fetch = vi.fn().mockResolvedValue(res(200, { tree: [] }))
    await createGitHub({ token: 't', repo: 'me/d', fetch }).getTree()
    expect(fetch.mock.calls[0][1].cache).toBe('no-store')
  })
  describe('rate limit detection', () => {
    const kindOf = async (status, body, headers) => {
      const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(status, body, headers)) })
      return gh.getTree().catch(e => e)
    }
    it('429', async () => {
      const e = await kindOf(429, { message: 'x' })
      expect(e.kind).toBe('ratelimit'); expect(e.resetAt).toBeGreaterThan(Date.now())
    })
    it('403 with retry-after', async () => {
      const e = await kindOf(403, { message: 'x' }, { 'retry-after': '30' })
      expect(e.kind).toBe('ratelimit')
      expect(e.resetAt).toBeGreaterThan(Date.now() + 20000); expect(e.resetAt).toBeLessThan(Date.now() + 40000)
    })
    it('403 with abuse / rate limit message', async () => {
      expect((await kindOf(403, { message: 'You have exceeded a secondary rate limit' })).kind).toBe('ratelimit')
      expect((await kindOf(403, { message: 'abuse detection' })).kind).toBe('ratelimit')
    })
    it('403 otherwise is auth', async () => {
      expect((await kindOf(403, { message: 'Resource not accessible' })).kind).toBe('auth')
    })
  })
  it('repo-wide 404 maps to repomissing for ping and getTree, but stays notfound per file', async () => {
    const mk = () => createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(404, { message: 'Not Found' })) })
    await expect(mk().ping()).rejects.toMatchObject({ kind: 'repomissing' })
    await expect(mk().getTree()).rejects.toMatchObject({ kind: 'repomissing' })
    await expect(mk().getFile('cards/a.json')).rejects.toMatchObject({ kind: 'notfound' })
  })
  it('"empty" message only means an empty repo on 409', async () => {
    const gh = createGitHub({ token: 't', repo: 'me/d', fetch: vi.fn().mockResolvedValue(res(404, { message: 'repository is empty' })) })
    await expect(gh.getTree()).rejects.toMatchObject({ kind: 'repomissing' })
  })
})
