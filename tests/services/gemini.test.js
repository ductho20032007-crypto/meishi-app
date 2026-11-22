import { describe, it, expect, vi } from 'vitest'
import { createGemini, mergeOcr, sanitizeOcr, DEFAULT_MODELS, THINKING_CONFIG } from '../../src/services/gemini.js'
const ok = obj => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 })
describe('gemini', () => {
  it('sends images + schema and parses JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ name: '山田 太郎', title: '課長', deptPath: ['営業本部'], rank: 5 }))
    const g = createGemini({ key: 'K', model: 'gemini-flash-latest', fetch })
    const r = await g.extract([{ mimeType: 'image/jpeg', data: 'AAA' }])
    expect(r.name).toBe('山田 太郎')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('K')
    const body = JSON.parse(init.body)
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAA' } })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
  it.each([[429, 'quota'], [400, 'auth'], [403, 'auth'], [500, 'other']])('maps %i → %s', async (s, kind) => {
    const g = createGemini({ key: 'K', fetch: vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: s })) })
    await expect(g.extract([])).rejects.toMatchObject({ kind })
  })
  it('sanitizes and fills rank from title', () => {
    const s = sanitizeOcr({ name: ' A ', title: '部長', rank: 99, phones: [{ type: 'mobile', value: '1' }, { value: '' }], emails: 'x' })
    expect(s).toMatchObject({ name: 'A', rank: 4, phones: [{ type: 'mobile', value: '1' }], emails: [], deptPath: [] })
  })
  it('mergeOcr keeps user-entered fields', () => {
    const card = { id: '1', name: '', memo: 'm', tags: ['t'], phones: [], status: 'pending' }
    const m = mergeOcr(card, { name: 'N', phones: [{ type: 'mobile', value: '1' }], memo: 'ignored' })
    expect(m).toMatchObject({ name: 'N', memo: 'm', tags: ['t'], status: 'done', ocrBy: 'gemini', ocrError: null })
  })
})

const err = (status, message) => new Response(JSON.stringify({ error: { message } }), { status })
const card = { name: 'N', title: '課長', deptPath: [], rank: 5 }
const modelOf = c => c[0].match(/models\/([^:]+):/)[1]
describe('gemini fallback / retry', () => {
  const sleep = vi.fn().mockResolvedValue()
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
})
it('falls back on per-model quota (429) and keeps kind quota if all fail', async () => {
  const sleep = vi.fn()
  const f1 = vi.fn().mockImplementationOnce(async () => err(429, 'quota')).mockImplementation(async () => ok(card))
  expect((await createGemini({ key: 'K', fetch: f1, sleep }).extract([])).name).toBe('N')
  const f2 = vi.fn().mockImplementation(async () => err(429, 'quota'))
  await expect(createGemini({ key: 'K', fetch: f2, sleep }).extract([])).rejects.toMatchObject({ kind: 'quota' })
})
