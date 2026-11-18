/**
 * Display math for the track change transition. Copied from Knowns UI registry/knowns/ui/knowns/blocks/media/crossfade-utils.ts at
 * commit cff14e21 (crossfadeGains, mixProgress only; no audio code). Equal power keeps out² + in² = 1 through the middle.
 */

export type CrossfadeCurve = 'equal-power' | 'linear'

export function crossfadeGains(progress: number, curve: CrossfadeCurve = 'equal-power'): { out: number; in: number } {
  const p = Math.min(1, Math.max(0, isFinite(progress) ? progress : 0))
  if (curve === 'linear') return { out: 1 - p, in: p }
  return { out: Math.cos((p * Math.PI) / 2), in: Math.sin((p * Math.PI) / 2) }
}

export function mixProgress(position: number, start: number, duration: number): number {
  return duration > 0 ? Math.min(1, Math.max(0, (position - start) / duration)) : position >= start ? 1 : 0
}

/** The kit's "out" easing (--kn-ease-out, cubic-bezier(.22,1,.36,1) ~ ease-out cubic) applied to a 0..1 progress. */
export const easeOut = (p: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3)
