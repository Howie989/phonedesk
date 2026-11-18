import type { HassState } from "../automation-types";
import { t } from "../i18n";
import { convertTemp1, tempUnitOf, type TempUnit } from "../temperature";

/** `entityId`: call this entity instead of the tile's (a related select on the same device). */
export interface ControlPlan { service: string; entityId?: string; data?: Record<string, unknown> }
export type ControlResult = ControlPlan | { error: string };

const err = (error: string): { error: string } => ({ error });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const fix = (n: number) => Math.round(n * 1000) / 1000;
const snap = (v: number, step: number) => fix(Math.round(v / step) * step);

const COLOR_MODES = ["hs", "rgb", "rgbw", "rgbww", "xy"];
/** HA cover feature bit for set_position. */
const COVER_SET_POSITION = 4;

function oneOf(op: string, value: unknown, allowed: string[], what: string): string | { error: string } {
  if (typeof value !== "string" || !value) return err(t("{op} needs a value ({what})", { op, what }));
  if (!allowed.includes(value)) return err(t("{what} \"{value}\" is not supported (available: {list})", { what, value, list: allowed.join(", ") || t("none") }));
  return value;
}

/** `valueUnit`: the unit of a temperature value from the phone (its display unit); `deviceUnit`: what the device speaks. */
export interface ControlUnits { valueUnit?: TempUnit; deviceUnit?: TempUnit; /** selects on the same HA device as the tile's light (agent-derived, never from the phone) */ related?: { id: string; name?: string; options: string[] }[] }

function climate(a: Record<string, any>, op: string, value: unknown, u: ControlUnits = {}): ControlResult {
  switch (op) {
    case "turn_on": case "turn_off": return { service: `climate.${op}` };
    case "set_temperature": {
      if (!isNum(value)) return err(t("set_temperature needs a number"));
      // the phone sends what it shows; the device only understands its own unit
      const dev = tempUnitOf(a.temperature_unit) ?? u.deviceUnit;
      const v = u.valueUnit && dev && u.valueUnit !== dev ? convertTemp1(value, u.valueUnit, dev) : value;
      const min = isNum(a.min_temp) ? a.min_temp : 7, max = isNum(a.max_temp) ? a.max_temp : 35;
      if (v < min || v > max) return err(t("temperature must be between {min} and {max}", { min, max }));
      const step = isNum(a.target_temp_step) && a.target_temp_step > 0 ? a.target_temp_step : 0.5;
      return { service: "climate.set_temperature", data: { temperature: Math.min(max, Math.max(min, snap(v, step))) } };
    }
    case "set_hvac_mode": { const m = oneOf(op, value, list(a.hvac_modes), t("mode")); return typeof m === "string" ? { service: "climate.set_hvac_mode", data: { hvac_mode: m } } : m; }
    case "set_fan_mode": { const m = oneOf(op, value, list(a.fan_modes), t("fan mode")); return typeof m === "string" ? { service: "climate.set_fan_mode", data: { fan_mode: m } } : m; }
    case "set_swing_mode": { const m = oneOf(op, value, list(a.swing_modes), t("swing mode")); return typeof m === "string" ? { service: "climate.set_swing_mode", data: { swing_mode: m } } : m; }
  }
  return err(t("climate has no operation \"{op}\"", { op }));
}

function light(a: Record<string, any>, op: string, value: unknown, u: ControlUnits = {}): ControlResult {
  const modes = list(a.supported_color_modes);
  const dimmable = !modes.length || modes.some((m) => m !== "onoff");
  const data: Record<string, unknown> = {};
  const addBrightness = (v: unknown) => {
    if (!isNum(v) || v < 1 || v > 100) return err(t("brightness must be between 1 and 100"));
    if (!dimmable) return err(t("this light cannot be dimmed"));
    data.brightness_pct = Math.round(v);
  };
  const addKelvin = (v: unknown) => {
    const min = isNum(a.min_color_temp_kelvin) ? a.min_color_temp_kelvin : 2000, max = isNum(a.max_color_temp_kelvin) ? a.max_color_temp_kelvin : 6500;
    if (!modes.includes("color_temp")) return err(t("this light has no adjustable color temperature"));
    if (!isNum(v) || v < min || v > max) return err(t("color temperature must be between {min} and {max} K", { min, max }));
    data.color_temp_kelvin = Math.round(v);
  };
  const addHs = (v: unknown) => {
    if (!modes.some((m) => COLOR_MODES.includes(m))) return err(t("this light has no adjustable color"));
    if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1]) || v[0] < 0 || v[0] > 360 || v[1] < 0 || v[1] > 100) return err(t("color must be [hue 0-360, saturation 0-100]"));
    data.hs_color = [fix(v[0]), fix(v[1])];
  };
  let e: { error: string } | undefined;
  switch (op) {
    case "turn_off": return { service: "light.turn_off" };
    case "set_effect": {
      const m = oneOf(op, value, list(a.effect_list), t("effect"));
      return typeof m === "string" ? { service: "light.turn_on", data: { effect: m } } : m;
    }
    case "set_scene": {
      // the scene lives in a select on the same device: prefer one named like a scene, else the only one
      const sels = u.related ?? [];
      const sel = sels.find((s) => /scene/i.test(`${s.id} ${s.name ?? ""}`)) ?? (sels.length === 1 ? sels[0] : undefined);
      if (!sel) return err(t("this light has no scene picker"));
      const m = oneOf(op, value, sel.options, t("scene"));
      return typeof m === "string" ? { service: "select.select_option", entityId: sel.id, data: { option: m } } : m;
    }
    case "set_brightness": e = addBrightness(value); break;
    case "set_color_temp": e = addKelvin(value); break;
    case "set_hs_color": e = addHs(value); break;
    case "turn_on":
      if (value === undefined || value === null) break;
      if (isNum(value)) { e = addBrightness(value); break; }
      if (typeof value === "object" && !Array.isArray(value)) {
        const v = value as Record<string, unknown>;
        const unknown = Object.keys(v).filter((k) => !["brightness_pct", "color_temp_kelvin", "hs_color"].includes(k));
        if (unknown.length) return err(t("light.turn_on does not accept {list}", { list: unknown.join(", ") }));
        if (v.brightness_pct !== undefined) e = addBrightness(v.brightness_pct);
        if (!e && v.color_temp_kelvin !== undefined) e = addKelvin(v.color_temp_kelvin);
        if (!e && v.hs_color !== undefined) e = addHs(v.hs_color);
        if (!e && v.color_temp_kelvin !== undefined && v.hs_color !== undefined) e = err(t("choose either color temperature or color, not both"));
        break;
      }
      return err(t("the turn_on value must be a brightness (number) or {brightness_pct, color_temp_kelvin, hs_color}"));
    default: return err(t("light has no operation \"{op}\"", { op }));
  }
  return e ?? { service: "light.turn_on", ...(Object.keys(data).length ? { data } : {}) };
}

function fan(a: Record<string, any>, op: string, value: unknown): ControlResult {
  switch (op) {
    case "turn_on": case "turn_off": return { service: `fan.${op}` };
    case "set_percentage": {
      if (!isNum(value) || value < 0 || value > 100) return err(t("speed must be between 0 and 100"));
      const step = isNum(a.percentage_step) && a.percentage_step > 0 ? a.percentage_step : 1;
      return { service: "fan.set_percentage", data: { percentage: Math.min(100, Math.max(0, Math.round(snap(value, step)))) } };
    }
    case "set_preset_mode": { const m = oneOf(op, value, list(a.preset_modes), t("mode")); return typeof m === "string" ? { service: "fan.set_preset_mode", data: { preset_mode: m } } : m; }
    case "oscillate":
      if (typeof value !== "boolean") return err(t("oscillate needs true or false"));
      return { service: "fan.oscillate", data: { oscillating: value } };
  }
  return err(t("fan has no operation \"{op}\"", { op }));
}

function cover(a: Record<string, any>, op: string, value: unknown): ControlResult {
  switch (op) {
    case "open_cover": case "close_cover": case "stop_cover": return { service: `cover.${op}` };
    case "set_cover_position":
      if (!isNum(value) || value < 0 || value > 100) return err(t("position must be between 0 and 100"));
      if (isNum(a.supported_features) && !(a.supported_features & COVER_SET_POSITION)) return err(t("this cover cannot be set to a position"));
      return { service: "cover.set_cover_position", data: { position: Math.round(value) } };
  }
  return err(t("cover has no operation \"{op}\"", { op }));
}

const VACUUM_OPS = ["start", "pause", "return_to_base", "locate"];
function vacuum(_a: Record<string, any>, op: string): ControlResult {
  return VACUUM_OPS.includes(op) ? { service: `vacuum.${op}` } : err(t("vacuum has no operation \"{op}\"", { op }));
}

/** Domains that have detail controls, and their ops (for the phone and for tests). */
export const CONTROL_OPS: Record<string, string[]> = {
  climate: ["set_temperature", "set_hvac_mode", "set_fan_mode", "set_swing_mode", "turn_on", "turn_off"],
  light: ["turn_on", "turn_off", "set_brightness", "set_color_temp", "set_hs_color", "set_effect", "set_scene"],
  fan: ["set_percentage", "set_preset_mode", "oscillate", "turn_on", "turn_off"],
  cover: ["set_cover_position", "open_cover", "close_cover", "stop_cover"],
  vacuum: VACUUM_OPS,
};

/**
 * The deck's control sheets send short op names ("temperature", "hvac_mode", "power", "dock"…); the service-style names
 * ("set_temperature"…) are the canonical ones. Both are accepted so a phone running an older or newer bundle keeps
 * working. Found 2026-11-17: every control from the phone was refused because of this naming mismatch.
 */
export function normalizeOp(domain: string, op: string, value: unknown): { op: string; value: unknown } {
  const common: Record<string, string> = {
    temperature: "set_temperature", hvac_mode: "set_hvac_mode", fan_mode: "set_fan_mode", swing_mode: "set_swing_mode",
    brightness: "set_brightness", effect: "set_effect", scene: "set_scene", color_temp: "set_color_temp", percentage: "set_percentage", preset: "set_preset_mode",
    preset_mode: "set_preset_mode", position: "set_cover_position", dock: "return_to_base",
  };
  if (op === "power") return { op: value === false || value === "off" ? "turn_off" : "turn_on", value: undefined };
  if (domain === "light" && op === "hue") return { op: "set_hs_color", value: Array.isArray(value) ? value : [Number(value), 100] };
  if (domain === "cover" && (op === "open" || op === "close" || op === "stop")) return { op: `${op}_cover`, value };
  return { op: common[op] ?? op, value };
}

/** Validates an op against the entity's live attributes and maps it to a service call (target = that entity). */
export function planControl(entityId: string, st: HassState | undefined, rawOp: unknown, rawValue?: unknown, units: ControlUnits = {}): ControlResult {
  if (typeof rawOp !== "string" || !rawOp) return err(t("missing op"));
  const domain = entityId.split(".")[0]!;
  const { op, value } = normalizeOp(domain, rawOp, rawValue);
  if (!CONTROL_OPS[domain]) return err(t("{domain} has no detailed controls yet", { domain }));
  if (!st) return err(t("no state for this device yet (is Home Assistant connected?)"));
  if (st.state === "unavailable") return err(t("the device is unavailable"));
  const a = st.attributes ?? {};
  switch (domain) {
    case "climate": return climate(a, op, value, units);
    case "light": return light(a, op, value, units);
    case "fan": return fan(a, op, value);
    case "cover": return cover(a, op, value);
    default: return vacuum(a, op);
  }
}
