import { it, expect, beforeEach } from 'vitest'
import { getConfig, saveKeys, clearKeys, hasKeys, setPref } from '../../src/services/settings.js'
beforeEach(() => localStorage.clear())
it('stores and clears keys', () => {
  expect(hasKeys()).toBe(false)
  saveKeys({ gh: 't', repo: 'me/d', gk: 'k' })
  expect(hasKeys()).toBe(true)
  expect(getConfig()).toMatchObject({ gh: 't', repo: 'me/d', gk: 'k', model: '' })
  setPref('model', 'gemini-3.5-flash'); expect(getConfig().model).toBe('gemini-3.5-flash')
  clearKeys(); expect(hasKeys()).toBe(false); expect(getConfig().model).toBe('gemini-3.5-flash')
})
