import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGemini, mergeOcr, sanitizeOcr, DEFAULT_MODELS, THINKING_CONFIG } from '../../src/services/gemini.js'
const ok = obj => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 })
const err = (status, message, extra = {}) => new Response(JSON.stringify({ error: { message, ...extra } }), { status })
const card = { name: 'N', title: '課長', deptPath: [], rank: 5 }
const modelOf = c => c[0].match(/models\/([^:]+):/)[1]
const sleep = vi.fn().mockResolvedValue()
beforeEach(() => sleep.mockClear())

describe('gemini', () => {
  it('sends images + schema and parses JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ name: '山田 太郎', title: '課長', deptPath: ['営業本部'], rank: 5 }))
    const g = createGemini({ key: 'K', model: 'gemini-flash-latest', fetch })
    const r = await g.extract([{ mimeType: 'image/jpeg', data: 'AAA' }, { mimeType: 'image/png', data: 'BBB' }])
    expect(r.name).toBe('山田 太郎')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('K')
    const body = JSON.parse(init.body)
    expect(body.contents[0].parts.slice(1)).toEqual([
      { text: 'Image 1 = front' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAA' } },
      { text: 'Image 2 = back' }, { inlineData: { mimeType: 'image/png', data: 'BBB' } }
    ])
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('sanitizes and fills rank from title', () => {
    const s = sanitizeOcr({ name: ' A ', title: '部長', rank: 99, phones: [{ type: 'mobile', value: '1' }, { value: '' }], emails: 'x' })
    expect(s).toMatchObject({ name: 'A', rank: 4, phones: [{ type: 'mobile', value: '1' }], emails: [], deptPath: [] })
  })
  it('dictionary rank wins over the model rank; model rank used for unknown titles', () => {
    expect(sanitizeOcr({ title: '課長', rank: 7 }).rank).toBe(5)
    expect(sanitizeOcr({ title: 'Zzz Wizard', rank: '5' }).rank).toBe(5)
    expect(sanitizeOcr({ title: 'Zzz Wizard', rank: 'x' }).rank).toBe(7)
    expect(sanitizeOcr({ title: 'Zzz Wizard', rank: 0 }).rank).toBe(7)
  })
  it('sanitizeOcr rejects non-objects', () => {
    for (const bad of [[], null, 'x', 5]) expect(() => sanitizeOcr(bad)).toThrow()
  })
  it('mergeOcr keeps user-entered fields and stores a snapshot', () => {
    const c = { id: '1', name: 'User', memo: 'm', tags: ['t'], phones: [], rank: null, status: 'pending' }
    const m = mergeOcr(c, { name: 'N', title: '課長', rank: 5, phones: [{ type: 'mobile', value: '1' }], memo: 'ignored' })
    expect(m).toMatchObject({ name: 'User', memo: 'm', tags: ['t'], rank: 5, phones: [{ type: 'mobile', value: '1' }], status: 'done', ocrBy: 'gemini', ocrError: null })
    expect(m.ocrSnapshot).toMatchObject({ name: 'N', title: '課長', rank: 5 })
    expect(m.ocrSnapshot.memo).toBeUndefined()
  })
  it('mergeOcr on a re-read replaces values still equal to the previous OCR, keeps edits, drops rereadFrom', () => {
    const prev = { name: 'Old', title: '課長', rank: 5, emails: ['a@x'], phones: [] }
    const c = { id: '1', status: 'pending', name: 'Old', title: '部長', rank: 4, emails: ['a@x'], phones: [], address: '', rereadFrom: prev }
    const m = mergeOcr(c, { name: 'New', title: '係長', rank: 6, emails: ['b@x'], phones: [], address: 'Tokyo' })
    expect(m).toMatchObject({ name: 'New', title: '部長', rank: 4, emails: ['b@x'], address: 'Tokyo', status: 'done' })
    expect('rereadFrom' in m).toBe(false)
    expect(m.ocrSnapshot.title).toBe('係長')
  })
})

describe('gemini error classes', () => {
  const kindOf = async resp => {
    const g = createGemini({ key: 'K', model: 'm', fetch: vi.fn().mockImplementation(async () => resp()), sleep })
    return g.extract([]).catch(e => e.kind)
  }
  it.each([
    ['429 quota', () => err(429, 'x', { status: 'RESOURCE_EXHAUSTED' }), 'quota'],
    ['400 invalid key', () => err(400, 'API key not valid. Please pass a valid API key.', { details: [{ reason: 'API_KEY_INVALID' }] }), 'auth'],
    ['400 key expired', () => err(400, 'API key expired. Please renew the API key.'), 'auth'],
    ['403', () => err(403, 'denied', { status: 'PERMISSION_DENIED' }), 'auth'],
    ['401', () => err(401, 'x'), 'auth'],
    ['400 location', () => err(400, 'User location is not supported for the API use.', { status: 'FAILED_PRECONDITION' }), 'region'],
    ['400 schema', () => err(400, 'Invalid JSON payload received. Unknown name "foo"', { status: 'INVALID_ARGUMENT' }), 'bad_request'],
    ['500', () => err(500, 'oops', { status: 'INTERNAL' }), 'busy'],
    ['504', () => err(504, 'x', { status: 'DEADLINE_EXCEEDED' }), 'busy'],
    ['503', () => err(503, 'x'), 'busy']
  ])('%s', async (_n, mk, kind) => { expect(await kindOf(mk)).toBe(kind) })
  it('non-JSON error body still classifies by status', async () => {
    expect(await kindOf(() => new Response('<html>', { status: 502 }))).toBe('busy')
  })
  it('network error rejects immediately with kind network', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'network' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('bad_request / auth / region do not fall back', async () => {
    const fetch = vi.fn().mockImplementation(async () => err(400, 'Invalid JSON payload'))
    await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'bad_request' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('gemini fallback / retry', () => {
  it('falls back to the next model after busy + one retry', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(err(503, 'high demand')).mockResolvedValueOnce(err(503, 'high demand'))
      .mockResolvedValueOnce(ok(card))
    const g = createGemini({ key: 'K', fetch, sleep })
    expect((await g.extract([])).name).toBe('N')
    expect(fetch.mock.calls.map(modelOf)).toEqual([DEFAULT_MODELS[0], DEFAULT_MODELS[0], DEFAULT_MODELS[1]])
    expect(sleep).toHaveBeenCalledTimes(1)
  })
  it('retries once on busy before success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(err(503, 'x')).mockResolvedValueOnce(ok(card))
    await createGemini({ key: 'K', fetch, sleep }).extract([])
    expect(fetch.mock.calls.map(modelOf)).toEqual([DEFAULT_MODELS[0], DEFAULT_MODELS[0]])
  })
  it('moves on when a model is not found / no longer available', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(err(404, 'models/x is not found')).mockResolvedValueOnce(err(400, 'This model is no longer available to new users')).mockResolvedValueOnce(ok(card))
    const g = createGemini({ key: 'K', fetch, sleep })
    expect((await g.extract([])).name).toBe('N')
    expect(fetch.mock.calls.map(modelOf)).toEqual(DEFAULT_MODELS)
  })
  it('retries without thinkingConfig when unsupported', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(err(400, 'Thinking level is not supported for this model')).mockImplementation(async () => ok(card))
    const g = createGemini({ key: 'K', model: 'm1', fetch, sleep })
    await g.extract([]); await g.extract([])
    const bodies = fetch.mock.calls.map(c => JSON.parse(c[1].body).generationConfig)
    expect(bodies[0].thinkingConfig).toEqual(THINKING_CONFIG)
    expect(bodies[1].thinkingConfig).toBeUndefined()
    expect(bodies[2].thinkingConfig).toBeUndefined()
  })
  it('rejects with kind busy when every model is busy', async () => {
    const fetch = vi.fn().mockImplementation(async () => err(503, 'high demand'))
    await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'busy' })
    expect(fetch).toHaveBeenCalledTimes(DEFAULT_MODELS.length * 2)
  })
  it('explicit model disables the fallback list', async () => {
    const fetch = vi.fn().mockImplementation(async () => err(503, 'x'))
    await expect(createGemini({ key: 'K', model: 'mine', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'busy' })
    expect(new Set(fetch.mock.calls.map(modelOf))).toEqual(new Set(['mine']))
  })
  it('falls back on per-model quota (429) and keeps kind quota if all fail', async () => {
    const f1 = vi.fn().mockImplementationOnce(async () => err(429, 'quota')).mockImplementation(async () => ok(card))
    expect((await createGemini({ key: 'K', fetch: f1, sleep }).extract([])).name).toBe('N')
    const f2 = vi.fn().mockImplementation(async () => err(429, 'quota'))
    await expect(createGemini({ key: 'K', fetch: f2, sleep }).extract([])).rejects.toMatchObject({ kind: 'quota' })
  })
  it('busy outranks quota in the final error', async () => {
    const fetch = vi.fn().mockImplementationOnce(async () => err(429, 'q')).mockImplementation(async () => err(503, 'x'))
    await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'busy' })
  })
})

describe('gemini timeout / abort', () => {
  const hang = (_url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
  it('timeout moves to the next model without retrying the same one; final kind is busy', async () => {
    const fetch = vi.fn().mockImplementation(hang)
    await expect(createGemini({ key: 'K', fetch, sleep, timeoutMs: 15 }).extract([])).rejects.toMatchObject({ kind: 'busy' })
    expect(fetch.mock.calls.map(modelOf)).toEqual(DEFAULT_MODELS)
    expect(sleep).not.toHaveBeenCalled()
  })
  it('timeout on the first model then success on the next', async () => {
    const fetch = vi.fn().mockImplementationOnce(hang).mockImplementation(async () => ok(card))
    expect((await createGemini({ key: 'K', fetch, sleep, timeoutMs: 15 }).extract([])).name).toBe('N')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('caller abort rejects immediately with kind aborted', async () => {
    const fetch = vi.fn().mockImplementation(hang)
    const ac = new AbortController()
    const p = createGemini({ key: 'K', fetch, sleep }).extract([], { signal: ac.signal })
    setTimeout(() => ac.abort(), 10)
    await expect(p).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('already-aborted signal never calls fetch', async () => {
    const fetch = vi.fn()
    const ac = new AbortController(); ac.abort()
    await expect(createGemini({ key: 'K', fetch, sleep }).extract([], { signal: ac.signal })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('gemini bad responses', () => {
  const resp = j => new Response(JSON.stringify(j), { status: 200 })
  it('no candidates / no text / SAFETY / unparseable / empty card fall through to the next model, final kind bad_response', async () => {
    const bodies = [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: '' }] } }] }, { candidates: [{ finishReason: 'SAFETY' }] }]
    for (const b of bodies) {
      const fetch = vi.fn().mockImplementation(async () => resp(b))
      await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'bad_response' })
      expect(fetch).toHaveBeenCalledTimes(DEFAULT_MODELS.length)
    }
    const text = t => ({ candidates: [{ content: { parts: [{ text: t }] } }] })
    for (const t of ['not json', '[]', '{"name":"","companyRaw":"","phones":[],"emails":[]}']) {
      const fetch = vi.fn().mockImplementation(async () => resp(text(t)))
      await expect(createGemini({ key: 'K', fetch, sleep }).extract([])).rejects.toMatchObject({ kind: 'bad_response' })
    }
  })
  it('a bad response on one model then a good one on the next succeeds', async () => {
    const fetch = vi.fn().mockImplementationOnce(async () => resp({ candidates: [] })).mockImplementation(async () => ok(card))
    expect((await createGemini({ key: 'K', fetch, sleep }).extract([])).name).toBe('N')
  })
})
