import { it, expect } from 'vitest'
import { newCardId, newCompanyId, newPlaceholderId } from '../../src/lib/ids.js'
it('formats ids', () => {
  expect(newCardId(new Date(2026, 10, 20))).toMatch(/^20261120-[a-z0-9]{6}$/)
  expect(newCompanyId()).toMatch(/^c-[a-z0-9]{8}$/)
  expect(newPlaceholderId()).toMatch(/^p-[a-z0-9]{6}$/)
})
