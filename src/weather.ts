import type { WeatherOptions } from "./automation";
import type { HassLike, HassWeather } from "./automation-types";
import { t } from "./i18n";
import { convertTemp, tempUnitOf, type TempUnit } from "./temperature";

export const WEATHER_TTL_MS = 15 * 60_000;

export interface WeatherNow { temp: number; feels?: number; condition: string; code: number; icon: string; humidity?: number; wind?: number; isDay?: boolean }
export interface WeatherHour { time: string; temp: number; condition: string; code: number; icon: string }
export interface WeatherDay { date: string; min: number; max: number; condition: string; code: number; icon: string }
export interface WeatherData {
  now: WeatherNow;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  source: "hass" | "open-meteo";
  location: string;
  units: "metric" | "imperial";
  /** The unit every temperature in this answer is in. */
  tempUnit: "c" | "f";
  updatedAt: number;
}

/** WMO weather code -> Vietnamese text and a short icon key the deck maps to a glyph. */
export function wmo(code: number): { text: string; icon: string } {
  if (code === 0) return { text: t("Clear sky"), icon: "sun" };
  if (code === 1) return { text: t("Mostly clear"), icon: "sun" };
  if (code === 2) return { text: t("Partly cloudy"), icon: "cloud-sun" };
  if (code === 3) return { text: t("Cloudy"), icon: "cloud" };
  if (code === 45 || code === 48) return { text: t("Fog"), icon: "fog" };
  if (code >= 51 && code <= 55) return { text: t("Drizzle"), icon: "drizzle" };
  if (code === 56 || code === 57) return { text: t("Freezing drizzle"), icon: "drizzle" };
  if (code === 61) return { text: t("Light rain"), icon: "rain" };
  if (code === 63) return { text: t("Rain"), icon: "rain" };
  if (code === 65) return { text: t("Heavy rain"), icon: "rain" };
  if (code === 66 || code === 67) return { text: t("Freezing rain"), icon: "rain" };
  if (code >= 71 && code <= 77) return { text: t("Snow"), icon: "snow" };
  if (code >= 80 && code <= 82) return { text: t("Showers"), icon: "rain" };
  if (code === 85 || code === 86) return { text: t("Snow showers"), icon: "snow" };
  if (code === 95) return { text: t("Thunderstorm"), icon: "storm" };
  if (code === 96 || code === 99) return { text: t("Thunderstorm with hail"), icon: "storm" };
  return { text: t("Unknown"), icon: "cloud" };
}

/** Home Assistant weather condition -> Vietnamese text, icon and an approximate WMO code. */
const HASS_CONDITION: Record<string, { text: string; icon: string; code: number }> = {
  "clear-night": { text: "Clear sky", icon: "moon", code: 0 },
  sunny: { text: "Sunny", icon: "sun", code: 0 },
  partlycloudy: { text: "Partly cloudy", icon: "cloud-sun", code: 2 },
  cloudy: { text: "Cloudy", icon: "cloud", code: 3 },
  fog: { text: "Fog", icon: "fog", code: 45 },
  hail: { text: "Hail", icon: "rain", code: 67 },
  lightning: { text: "Lightning", icon: "storm", code: 95 },
  "lightning-rainy": { text: "Thunderstorm with rain", icon: "storm", code: 96 },
  pouring: { text: "Heavy rain", icon: "rain", code: 65 },
  rainy: { text: "Rain", icon: "rain", code: 63 },
  snowy: { text: "Snow", icon: "snow", code: 73 },
  "snowy-rainy": { text: "Sleet", icon: "snow", code: 68 },
  windy: { text: "Windy", icon: "wind", code: 3 },
  "windy-variant": { text: "Windy", icon: "wind", code: 3 },
  exceptional: { text: "Exceptional", icon: "cloud", code: 3 },
};
const hassCond = (c: unknown) => { const x = HASS_CONDITION[String(c)]; return x ? { ...x, text: t(x.text) } : { text: String(c ?? t("Unknown")), icon: "cloud", code: 3 }; };

const round = (n: unknown): number => Math.round(Number(n));
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);

/** Open-Meteo forecast JSON -> WeatherData (12 hours from the current hour, 7 days). */
export function parseOpenMeteo(j: any, o: { location: string; units: "metric" | "imperial"; tempUnit?: TempUnit; now: number }): WeatherData {
  const c = j?.current;
  if (!c || !finite(c.temperature_2m)) throw new Error("unexpected forecast answer");
  const code = Number(c.weather_code ?? 0);
  const w = wmo(code);
  const times: string[] = j.hourly?.time ?? [];
  const curHour = typeof c.time === "string" ? c.time.slice(0, 13) : "";
  let start = Math.max(0, times.findIndex((t) => t.slice(0, 13) >= curHour));
  if (!times.length) start = 0;
  const hourly: WeatherHour[] = times.slice(start, start + 12).map((t, i) => {
    const hc = Number(j.hourly.weather_code?.[start + i] ?? 0);
    const hw = wmo(hc);
    return { time: t, temp: round(j.hourly.temperature_2m?.[start + i]), condition: hw.text, code: hc, icon: hw.icon };
  });
  const dates: string[] = j.daily?.time ?? [];
  const daily: WeatherDay[] = dates.slice(0, 7).map((d, i) => {
    const dc = Number(j.daily.weather_code?.[i] ?? 0);
    const dw = wmo(dc);
    return { date: d, min: round(j.daily.temperature_2m_min?.[i]), max: round(j.daily.temperature_2m_max?.[i]), condition: dw.text, code: dc, icon: dw.icon };
  });
  return {
    now: {
      temp: round(c.temperature_2m),
      ...(finite(c.apparent_temperature) ? { feels: round(c.apparent_temperature) } : {}),
      condition: w.text, code, icon: c.is_day === 0 && w.icon === "sun" ? "moon" : w.icon,
      ...(finite(c.relative_humidity_2m) ? { humidity: round(c.relative_humidity_2m) } : {}),
      ...(finite(c.wind_speed_10m) ? { wind: round(c.wind_speed_10m) } : {}),
      ...(c.is_day !== undefined ? { isDay: c.is_day === 1 } : {}),
    },
    hourly, daily, source: "open-meteo", location: o.location, units: o.units, tempUnit: o.tempUnit ?? (o.units === "imperial" ? "f" : "c"), updatedAt: o.now,
  };
}

/** A Home Assistant weather entity (plus forecasts when available) -> WeatherData. */
export function parseHassWeather(h: HassWeather, o: { location: string; tempUnit?: TempUnit; now: number }): WeatherData {
  const a = h.attributes ?? {};
  const cond = hassCond(h.state);
  const from = tempUnitOf(a.temperature_unit) ?? "c";
  const to = o.tempUnit ?? from;
  const T = (n: unknown): number => round(convertTemp(Number(n), from, to));
  const hourly: WeatherHour[] = (h.hourly ?? []).slice(0, 12).map((f: any) => {
    const hc = hassCond(f.condition);
    return { time: String(f.datetime ?? ""), temp: T(f.temperature), condition: hc.text, code: hc.code, icon: hc.icon };
  });
  const daily: WeatherDay[] = (h.daily ?? []).slice(0, 7).map((f: any) => {
    const dc = hassCond(f.condition);
    return { date: String(f.datetime ?? "").slice(0, 10), min: T(f.templow ?? f.temperature), max: T(f.temperature), condition: dc.text, code: dc.code, icon: dc.icon };
  });
  return {
    now: {
      temp: T(a.temperature), condition: cond.text, code: cond.code, icon: cond.icon,
      ...(finite(a.apparent_temperature) ? { feels: T(a.apparent_temperature) } : {}),
      ...(finite(a.humidity) ? { humidity: round(a.humidity) } : {}),
      ...(finite(a.wind_speed) ? { wind: round(a.wind_speed) } : {}),
    },
    hourly, daily, source: "hass", location: o.location, units: from === "f" ? "imperial" : "metric", tempUnit: to, updatedAt: o.now,
  };
}

export interface GeoPlace { name: string; lat: number; lon: number; country?: string; admin?: string }

export interface WeatherDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  hass?: () => HassLike | undefined;
  now?: () => number;
  ttlMs?: number;
}

type Resolved = { kind: "hass"; entity: string } | { kind: "open-meteo"; lat: number; lon: number; name: string };

/** Fetches weather per tile option set, caching each location/entity for 15 minutes. */
export class WeatherService {
  private cache = new Map<string, { at: number; data: WeatherData }>();
  private inflight = new Map<string, Promise<WeatherData>>();
  constructor(private d: WeatherDeps = {}) {}

  private get now() { return (this.d.now ?? Date.now)(); }
  private get ttl() { return this.d.ttlMs ?? WEATHER_TTL_MS; }
  private doFetch(url: string) { return (this.d.fetch ?? fetch)(url, { signal: AbortSignal.timeout(8000) }); }

  /** Which backend an option set resolves to right now. */
  resolve(o: WeatherOptions): Resolved {
    const source = o.source ?? "auto";
    const ha = this.d.hass?.();
    if (source !== "open-meteo" && o.entity && (source === "hass" || ha?.connected())) return { kind: "hass", entity: o.entity };
    if (source === "hass") throw new Error(t("no Home Assistant weather.* entity selected"));
    if (!o.location) throw new Error(t("Pick a city in Manage > Weather, or connect Home Assistant"));
    return { kind: "open-meteo", lat: o.location.lat, lon: o.location.lon, name: o.location.name };
  }

  /**
   * resolve(), plus: a tile that picked no entity uses the weather.* entity of a connected Home Assistant (preferred over the
   * saved location), so connecting Home Assistant later is enough.
   */
  private async pick(o: WeatherOptions): Promise<Resolved> {
    if (!o.entity && (o.source ?? "auto") !== "open-meteo") {
      const ha = this.d.hass?.();
      if (ha?.connected() && ha.weatherEntity) {
        const entity = await ha.weatherEntity().catch(() => null);
        if (entity) return { kind: "hass", entity };
      }
    }
    return this.resolve(o);
  }

  /**
   * `themeUnit` is theme.temperatureUnit (missing = c); a tile's own `units` wins for that tile.
   * Every temperature in the answer is in that unit, whatever Home Assistant or Open-Meteo natively use.
   */
  async get(o: WeatherOptions, force = false, themeUnit?: TempUnit): Promise<WeatherData> {
    const units = o.units ?? "metric";
    const tempUnit: TempUnit = o.units ? (o.units === "imperial" ? "f" : "c") : themeUnit ?? "c";
    const r = await this.pick(o);
    const key = r.kind === "hass" ? `hass:${r.entity}:${tempUnit}` : `om:${r.lat.toFixed(2)},${r.lon.toFixed(2)}:${units}:${tempUnit}`;
    const hit = this.cache.get(key);
    if (hit && !force && this.now - hit.at < this.ttl) return hit.data;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const data = r.kind === "hass" ? await this.fromHass(r.entity, tempUnit) : await this.fromOpenMeteo(r.lat, r.lon, r.name, units, tempUnit);
        this.cache.set(key, { at: this.now, data });
        return data;
      } catch (e) {
        // keep showing the last good answer when the network hiccups
        if (hit) return hit.data;
        throw e;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private async fromHass(entity: string, tempUnit: TempUnit): Promise<WeatherData> {
    const ha = this.d.hass?.();
    if (!ha?.connected()) throw new Error(t("Home Assistant is not connected"));
    const w = (await ha.weather?.(entity)) ?? (ha.getState(entity) ? { state: ha.getState(entity)!.state, attributes: ha.getState(entity)!.attributes ?? {} } : null);
    if (!w) throw new Error(t("{entity} not found", { entity }));
    return parseHassWeather(w, { location: String(w.attributes?.friendly_name ?? entity), tempUnit, now: this.now });
  }

  private async fromOpenMeteo(lat: number, lon: number, name: string, units: "metric" | "imperial", tempUnit: TempUnit): Promise<WeatherData> {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      hourly: "temperature_2m,weather_code", daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "auto", forecast_days: "7",
      ...(tempUnit === "f" ? { temperature_unit: "fahrenheit" } : {}),
      ...(units === "imperial" ? { wind_speed_unit: "mph" } : {}),
    });
    const res = await this.doFetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(t("Open-Meteo returned {status}", { status: res.status }));
    return parseOpenMeteo(await res.json(), { location: name, units, tempUnit, now: this.now });
  }

  /** Place search for the management page (only the typed text leaves the machine). */
  async geocode(query: string): Promise<GeoPlace[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const res = await this.doFetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q.slice(0, 80), count: "6", language: "vi", format: "json" })}`);
    if (!res.ok) throw new Error(t("geocoding returned {status}", { status: res.status }));
    const j: any = await res.json();
    return (j.results ?? []).map((r: any) => ({ name: String(r.name), lat: Number(r.latitude), lon: Number(r.longitude), ...(r.country ? { country: String(r.country) } : {}), ...(r.admin1 ? { admin: String(r.admin1) } : {}) }));
  }
}
