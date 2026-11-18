import { VI } from './i18n-vi'

/**
 * Tiny dictionary i18n. English is the default; Vietnamese comes from layout.theme.language ('en' | 'vi', missing = 'en').
 * The English text is the key: t('Cancel') returns the Vietnamese entry when the language is 'vi' and the text itself otherwise.
 * Placeholders are {0}, {1}...: t('{0} min ago', 5). Module level constants must hold English text and be passed through t() at use time.
 */

export type Lang = 'en' | 'vi'
const KEY = 'pd.lang'
let cur: Lang = 'en'
try {
  const s = window.localStorage.getItem(KEY)
  if (s === 'vi' || s === 'en') cur = s
} catch (e) {
  /* storage is optional */
}

export const getLang = (): Lang => cur

/** Called by the deck whenever the layout (or its theme) changes; remembered so the pairing screen uses the same language. */
export function setLang(l: unknown) {
  const next: Lang = l === 'vi' ? 'vi' : 'en'
  if (next === cur) return
  cur = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch (e) {
    /* ignore */
  }
}

export function t(en: string, a?: string | number, b?: string | number, c?: string | number): string {
  let s = cur === 'vi' && Object.prototype.hasOwnProperty.call(VI, en) ? VI[en] : en
  const args = [a, b, c]
  for (let i = 0; i < 3; i++) {
    if (args[i] !== undefined) s = s.split('{' + i + '}').join(String(args[i]))
  }
  return s
}

/** BCP 47 tag for Intl and toLocaleString. */
export const locale = (): string => (cur === 'vi' ? 'vi-VN' : 'en-US')
