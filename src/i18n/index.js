// src/i18n/index.js — vue-i18n (composition mode). Locale: saved pref -> navigator.language (ja / vi) -> en.
import { createI18n } from 'vue-i18n'
import ja from './ja.json'
import vi from './vi.json'
import en from './en.json'
import { getConfig, setPref } from '../services/settings.js'

export const LOCALES = ['ja', 'vi', 'en']
export function pickLocale(lang) {
  const l = String(lang || '').toLowerCase()
  return l.startsWith('ja') ? 'ja' : l.startsWith('vi') ? 'vi' : 'en'
}
const saved = getConfig().lang
const initial = LOCALES.includes(saved) ? saved : pickLocale(globalThis.navigator?.language)

export const i18n = createI18n({ legacy: false, locale: initial, fallbackLocale: 'en', messages: { ja, vi, en } })
if (typeof document !== 'undefined') document.documentElement.lang = initial

// Switch the UI language and remember it on this device.
export function setLocale(lang) {
  if (!LOCALES.includes(lang)) return
  i18n.global.locale.value = lang
  setPref('lang', lang)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}
