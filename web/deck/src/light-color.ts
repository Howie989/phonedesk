/** Colours of Home Assistant lights: the real colour a light shows (hs / rgb / colour temperature) and the quick swatches. */
import type { HassEntity } from './types'

const A = (e: HassEntity | undefined, k: string): any => (e && e.attrs ? (e.attrs as { [k: string]: any })[k] : undefined)
const hex2 = (n: number) => {
  const v = Math.max(0, Math.min(255, Math.round(n)))
  return (v < 16 ? '0' : '') + v.toString(16)
}
export const rgbHex = (r: number, g: number, b: number): string => '#' + hex2(r) + hex2(g) + hex2(b)

/** hue 0-360, saturation 0-100, full value */
export function hsToHex(h: number, s: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100
  const hh = (((h % 360) + 360) % 360) / 60
  const c = sat
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = 1 - c
  const k = Math.floor(hh)
  const rgb = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x]
  return rgbHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

/** colour temperature in Kelvin to an sRGB hex (Tanner Helland's approximation) */
export function kelvinHex(kelvin: number): string {
  const t = Math.max(10, Math.min(400, kelvin / 100))
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return rgbHex(r, g, b)
}

/** The colour a light shows right now, as hex; null when it says nothing (plain on/off lights). */
export function lightColor(e: HassEntity | undefined): string | null {
  if (!e) return null
  const mode = String(A(e, 'color_mode') || '')
  const rgb = A(e, 'rgb_color')
  const hs = A(e, 'hs_color')
  let k = A(e, 'color_temp_kelvin')
  if (typeof k !== 'number' && typeof A(e, 'color_temp') === 'number' && A(e, 'color_temp') > 0) k = 1000000 / A(e, 'color_temp')
  const fromRgb = () => (Array.isArray(rgb) && rgb.length >= 3 ? rgbHex(rgb[0], rgb[1], rgb[2]) : null)
  const fromHs = () => (Array.isArray(hs) && hs.length >= 2 ? hsToHex(Number(hs[0]), Number(hs[1])) : null)
  const fromK = () => (typeof k === 'number' && k > 0 ? kelvinHex(k) : null)
  if (mode === 'color_temp') return fromK() || fromRgb() || fromHs()
  if (mode) return fromRgb() || fromHs() || fromK()
  return fromHs() || fromRgb() || fromK()
}

/** soft display colour for a white: the Kelvin colour mixed toward white so warm white does not look like amber */
const softWhite = (kelvin: number): string => {
  const h = kelvinHex(kelvin)
  const m = (i: number) => Math.round(parseInt(h.substr(1 + i * 2, 2), 16) * 0.55 + 255 * 0.45)
  return rgbHex(m(0), m(1), m(2))
}

export interface Swatch {
  id: string
  label: string
  color: string
  /** set_color_temp (Kelvin) or set_hs_color ([hue, saturation]) */
  op: 'color_temp' | 'hs'
  value: number | number[]
}
/** warm white, cool white, cyan, magenta, amber (what the light can do decides which ones show) */
export function swatchesFor(e: HassEntity | undefined): Swatch[] {
  const modes: string[] = Array.isArray(A(e, 'supported_color_modes')) ? A(e, 'supported_color_modes') : []
  const ct = modes.indexOf('color_temp') >= 0
  const hue = modes.some((m) => m === 'hs' || m === 'xy' || m.indexOf('rgb') === 0)
  const kmin = typeof A(e, 'min_color_temp_kelvin') === 'number' ? A(e, 'min_color_temp_kelvin') : 2000
  const kmax = typeof A(e, 'max_color_temp_kelvin') === 'number' ? A(e, 'max_color_temp_kelvin') : 6500
  const out: Swatch[] = []
  const warm = Math.max(kmin, 2700)
  const cool = Math.min(kmax, 6500)
  if (ct) out.push({ id: 'warm', label: 'Warm white', color: softWhite(warm), op: 'color_temp', value: warm })
  else if (hue) out.push({ id: 'warm', label: 'Warm white', color: softWhite(2700), op: 'hs', value: [30, 40] })
  if (ct) out.push({ id: 'cool', label: 'Cool white', color: softWhite(cool), op: 'color_temp', value: cool })
  else if (hue) out.push({ id: 'cool', label: 'Cool white', color: softWhite(6500), op: 'hs', value: [215, 12] })
  if (hue) {
    out.push({ id: 'cyan', label: 'Cyan', color: hsToHex(180, 100), op: 'hs', value: [180, 100] })
    out.push({ id: 'magenta', label: 'Magenta', color: hsToHex(300, 100), op: 'hs', value: [300, 100] })
    out.push({ id: 'amber', label: 'Amber', color: hsToHex(38, 100), op: 'hs', value: [38, 100] })
  }
  return out
}
