/** One place for temperature units: "c" | "f" as the theme and the devices name them. */
export type TempUnit = "c" | "f";

/** "°C", "°F", "C", "celsius"... -> unit; undefined when it is not a temperature unit. */
export function tempUnitOf(s: unknown): TempUnit | undefined {
  const v = String(s ?? "").toLowerCase().replace(/[°\s]/g, "");
  if (v === "c" || v === "celsius") return "c";
  if (v === "f" || v === "fahrenheit") return "f";
  return undefined;
}

export function convertTemp(v: number, from: TempUnit, to: TempUnit): number {
  if (from === to) return v;
  return from === "c" ? v * 9 / 5 + 32 : (v - 32) * 5 / 9;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Converted and rounded to one decimal (sensors, climate); weather rounds to whole degrees itself. */
export const convertTemp1 = (v: number, from: TempUnit, to: TempUnit) => round1(convertTemp(v, from, to));
