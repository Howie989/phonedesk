import type { Theme } from './types'

/** Applies layout.theme to the deck root: mode -> data-pd-theme, the rest -> CSS custom properties. */

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : NaN
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}

/** Only accept plain colour tokens so a theme cannot inject CSS. */
const color = (v: unknown): string | null =>
  typeof v === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : null

export function resolveMode(t: Theme | undefined): 'dark' | 'light' {
  const m = t && t.mode
  if (m === 'light') return 'light'
  if (m === 'auto') {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  }
  return 'dark'
}

const VARS = ['--pd-text', '--pd-text-2', '--pd-accent', '--pd-bg', '--pd-tile', '--pd-radius', '--pd-gap', '--pd-font']

export function applyTheme(root: HTMLElement, t: Theme | undefined) {
  const mode = resolveMode(t)
  root.setAttribute('data-pd-theme', mode)
  VARS.forEach((v) => root.style.removeProperty(v))
  if (!t) return
  const text = color(t.text)
  if (text) {
    root.style.setProperty('--pd-text', text)
    root.style.setProperty('--pd-text-2', text)
  }
  const accent = color(t.accent)
  if (accent) root.style.setProperty('--pd-accent', accent)
  const bg = color(t.background)
  if (bg) root.style.setProperty('--pd-bg', bg)
  const tile = color(t.tile)
  if (tile) root.style.setProperty('--pd-tile', tile)
  const radius = num(t.radius, 0, 40)
  if (radius !== null) root.style.setProperty('--pd-radius', radius + 'px')
  const gap = num(t.gap, 0, 40)
  if (gap !== null) root.style.setProperty('--pd-gap', gap + 'px')
  const fs = num(t.fontScale, 0.5, 2)
  if (fs !== null) root.style.setProperty('--pd-font', String(fs))
}

/** "#rgb" / "#rrggbb" -> [r,g,b], or null for anything else (named colours, rgb(), ...). */
export function hexToRgb(c: string | undefined): [number, number, number] | null {
  if (!c) return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Tint of an item colour: rgba computed here because Safari 12 has no color-mix(). */
export function tint(c: string | undefined, alpha: number): string | null {
  const rgb = hexToRgb(c)
  return rgb ? 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')' : null
}

/** Dark or light text, whichever reads better on a hex background; null for non-hex colours. */
export function readableOn(bg: string | undefined): string | null {
  const rgb = hexToRgb(bg)
  if (!rgb) return null
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150 ? '#111114' : '#ffffff'
}

/** Mixes a hex colour toward white (amt > 0) or black (amt < 0), amt -1..1. Returns a hex string; falls back to the input. */
export function shade(c: string | undefined, amt: number): string {
  const rgb = hexToRgb(c)
  if (!rgb) return c || '#22d3ee'
  const to = amt >= 0 ? 255 : 0
  const k = Math.abs(amt)
  const h = (v: number) => {
    const x = Math.round(v + (to - v) * k)
    return (x < 16 ? '0' : '') + x.toString(16)
  }
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2])
}
