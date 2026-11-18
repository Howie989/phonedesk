/** One place for temperature units: every temperature on the deck follows theme.temperatureUnit ('c' default), whatever the source reports. */
export type TUnit = 'C' | 'F'
let shown: TUnit = 'C'
export const setTempUnit = (u: string | undefined) => {
  shown = u === 'f' || u === 'F' ? 'F' : 'C'
}
export const tempUnit = (): TUnit => shown
/** 'C' or 'F' from "°C", "°F", "F", "celsius"...; `fallback` when it says neither */
export const unitOf = (s: unknown, fallback: TUnit = 'C'): TUnit => {
  const x = String(s === undefined || s === null ? '' : s).toUpperCase()
  return x.indexOf('F') >= 0 ? 'F' : x.indexOf('C') >= 0 ? 'C' : fallback
}
/** true for unit strings that mean a temperature ("°C", "°F") */
export const isTempUnit = (s: unknown): boolean => /^\s*°?\s*[CF]\s*$/i.test(String(s === undefined || s === null ? '' : s))
export const convTemp = (v: number, from: TUnit, to: TUnit): number => (from === to ? v : from === 'C' ? (v * 9) / 5 + 32 : ((v - 32) * 5) / 9)
/** `to` defaults to the shown unit; theme (if given) wins over the module state */
export const targetUnit = (theme?: { temperatureUnit?: string }): TUnit => (theme && theme.temperatureUnit ? (theme.temperatureUnit === 'f' ? 'F' : 'C') : shown)
const round1 = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1))
/**
 * formatTemp(value, fromUnit, theme): "28.4°C" / "83.1°F". dec: 0 = whole degrees (weather), 1 = one decimal when needed (sensors, default).
 * glyph: false drops the C/F letter and keeps only the degree sign.
 */
export function formatTemp(value: number | null | undefined, from: TUnit, theme?: { temperatureUnit?: string }, dec?: 0 | 1, glyph?: boolean): string {
  if (typeof value !== 'number' || !isFinite(value)) return '–'
  const to = targetUnit(theme)
  const v = convTemp(value, from, to)
  return (dec === 0 ? String(Math.round(v)) : round1(v)) + '°' + (glyph === false ? '' : to)
}
/** the converted number alone (display only; never send this back to a device) */
export const showTemp = (value: number, from: TUnit, theme?: { temperatureUnit?: string }): number => convTemp(value, from, targetUnit(theme))
