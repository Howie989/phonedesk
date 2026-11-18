import { useCallback, useState } from "react";

/** Landscape W x H in CSS px. Labels are English source text (translated where shown). */
export const SCREEN_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: "se1", label: "iPhone SE 1st / 5s", w: 568, h: 320 },
  { id: "se2", label: "iPhone SE 2/3 / 8", w: 667, h: 375 },
  { id: "iphone", label: "iPhone 14/15", w: 844, h: 390 },
  { id: "promax", label: "iPhone Pro Max", w: 932, h: 430 },
  { id: "android-s", label: "Android small", w: 640, h: 360 },
  { id: "android", label: "Android", w: 915, h: 412 },
  { id: "ipad-mini", label: "iPad mini", w: 1133, h: 744 },
  { id: "ipad", label: "iPad", w: 1180, h: 820 },
];
export const DEFAULT_PRESET = "iphone";
export const CUSTOM_MIN = 320;
export const CUSTOM_MAX = 1400;
const KEY = "pd.manage.screenSize";

export interface ScreenChoice { preset: string; w: number; h: number }
const clamp = (n: number) => Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.round(n) || CUSTOM_MIN));

function read(): ScreenChoice {
  const fallback = { preset: DEFAULT_PRESET, w: 844, h: 390 };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ScreenChoice> | null;
    if (!o) return fallback;
    if (o.preset === "custom" && typeof o.w === "number" && typeof o.h === "number") return { preset: "custom", w: clamp(o.w), h: clamp(o.h) };
    const p = SCREEN_PRESETS.find((x) => x.id === o.preset);
    return p ? { preset: p.id, w: p.w, h: p.h } : fallback;
  } catch {
    return fallback;
  }
}

/** The screen size being previewed (landscape W x H), remembered per viewer in the browser, never in the layout. */
export function useScreenSize(): [ScreenChoice, (c: { preset: string; w?: number; h?: number }) => void] {
  const [choice, setChoice] = useState<ScreenChoice>(read);
  const set = useCallback((c: { preset: string; w?: number; h?: number }) => {
    const p = SCREEN_PRESETS.find((x) => x.id === c.preset);
    const next: ScreenChoice = p ? { preset: p.id, w: p.w, h: p.h } : { preset: "custom", w: clamp(c.w ?? 844), h: clamp(c.h ?? 390) };
    setChoice(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);
  return [choice, set];
}
