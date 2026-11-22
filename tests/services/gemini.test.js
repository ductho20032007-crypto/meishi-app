import { describe, it, expect, vi } from 'vitest'
import { createGemini, mergeOcr, sanitizeOcr } from '../../src/services/gemini.js'
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
