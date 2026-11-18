import { describe, expect, test } from "bun:test";
import { WeatherService, parseHassWeather, parseOpenMeteo, wmo } from "../src/weather";

const om = (temp = 30) => ({
  current: { time: "2026-11-17T10:15", temperature_2m: temp, apparent_temperature: 33.4, relative_humidity_2m: 70, weather_code: 61, wind_speed_10m: 12.2, is_day: 1 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? "17" : "18"}T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => 20 + i),
    weather_code: Array.from({ length: 48 }, () => 3),
  },
  daily: { time: Array.from({ length: 7 }, (_, i) => `2026-11-${17 + i}`), weather_code: [0, 1, 2, 3, 61, 95, 71], temperature_2m_max: [31, 32, 33, 30, 29, 28, 27], temperature_2m_min: [24, 24, 25, 23, 22, 21, 20] },
});

describe("weather parsing", () => {
  test("WMO codes have English text", () => {
    expect(wmo(0).text).toBe("Clear sky");
    expect(wmo(61).text).toBe("Light rain");
    expect(wmo(95).icon).toBe("storm");
    expect(wmo(999).text).toBe("Unknown");
  });
  test("Open-Meteo: now, 12 hours from the current hour, 7 days", () => {
    const d = parseOpenMeteo(om(), { location: "Hanoi", units: "metric", now: 5 });
    expect(d.now).toMatchObject({ temp: 30, feels: 33, condition: "Light rain", humidity: 70, wind: 12, isDay: true });
    expect(d.hourly.length).toBe(12);
    expect(d.hourly[0]!.time).toBe("2026-11-17T10:00");
    expect(d.daily.length).toBe(7);
    expect(d.daily[4]).toMatchObject({ min: 22, max: 29, condition: "Light rain" });
    expect(d).toMatchObject({ source: "open-meteo", location: "Hanoi", updatedAt: 5 });
    expect(() => parseOpenMeteo({}, { location: "x", units: "metric", now: 0 })).toThrow("unexpected");
  });
  test("HA weather entity with forecasts", () => {
    const d = parseHassWeather({ state: "partlycloudy", attributes: { temperature: 28.4, humidity: 80, wind_speed: 9, temperature_unit: "°C", friendly_name: "Home" }, hourly: [{ datetime: "t", temperature: 27, condition: "rainy" }], daily: [{ datetime: "2026-11-17T00:00:00", temperature: 30, templow: 24, condition: "sunny" }] }, { location: "Nhà", now: 1 });
    expect(d.now).toMatchObject({ temp: 28, condition: "Partly cloudy", humidity: 80 });
    expect(d.hourly[0]!.condition).toBe("Rain");
    expect(d.daily[0]).toMatchObject({ date: "2026-11-17", min: 24, max: 30, condition: "Sunny" });
    expect(d.source).toBe("hass");
  });
});

describe("WeatherService", () => {
  const loc = { name: "HN", lat: 21.03, lon: 105.85 };
  function rig(hass?: any) {
    let t = 1000;
    const urls: string[] = [];
    let temp = 30, fail = false;
    const svc = new WeatherService({
      now: () => t, hass: () => hass,
      fetch: async (u) => { urls.push(u); if (fail) return new Response("no", { status: 500 }); return Response.json(u.includes("geocoding") ? { results: [{ name: "Hanoi", latitude: 21.0, longitude: 105.8, country: "Vietnam", admin1: "Hanoi" }] } : om(temp)); },
    });
    return { svc, urls, advance: (ms: number) => { t += ms; }, setTemp: (n: number) => { temp = n; }, setFail: (f: boolean) => { fail = f; } };
  }

  test("Open-Meteo: sends only coordinates, caches 15 minutes, then refetches", async () => {
    const r = rig();
    const a = await r.svc.get({ location: loc });
    expect(r.urls[0]).toContain("latitude=21.0300");
    expect(r.urls[0]).not.toContain("HN");
    await r.svc.get({ location: loc });
    expect(r.urls.length).toBe(1);
    r.advance(14 * 60_000);
    await r.svc.get({ location: loc });
    expect(r.urls.length).toBe(1);
    r.setTemp(25); r.advance(2 * 60_000);
    expect((await r.svc.get({ location: loc })).now.temp).toBe(25);
    expect(r.urls.length).toBe(2);
    expect(a.now.temp).toBe(30);
    await r.svc.get({ location: loc, units: "imperial" });
    expect(r.urls[2]).toContain("temperature_unit=fahrenheit");
  });
  test("concurrent calls share one request; a failing refresh keeps the last good answer; first failure throws", async () => {
    const r = rig();
    await Promise.all([r.svc.get({ location: loc }), r.svc.get({ location: loc })]);
    expect(r.urls.length).toBe(1);
    r.setFail(true); r.advance(20 * 60_000);
    expect((await r.svc.get({ location: loc })).now.temp).toBe(30);
    await expect(rig().svc.get({ location: { name: "x", lat: 1, lon: 1 } }).then(() => {})).resolves.toBeUndefined();
    const bad = rig(); bad.setFail(true);
    await expect(bad.svc.get({ location: loc })).rejects.toThrow("500");
  });
  test("auto picks the HA entity when HA is connected, else Open-Meteo; hass needs an entity; no location is an error", async () => {
    const ha = { connected: () => true, getState: () => ({ state: "sunny", attributes: { temperature: 31 } }), callService: async () => {}, weather: async () => ({ state: "rainy", attributes: { temperature: 22 }, hourly: [], daily: [] }) };
    const r = rig(ha);
    const d = await r.svc.get({ entity: "weather.home", location: loc });
    expect(d.source).toBe("hass");
    expect(d.now.condition).toBe("Rain");
    expect(r.urls.length).toBe(0);
    expect((await r.svc.get({ source: "open-meteo", entity: "weather.home", location: loc })).source).toBe("open-meteo");
    const off = rig({ ...ha, connected: () => false });
    expect((await off.svc.get({ entity: "weather.home", location: loc })).source).toBe("open-meteo");
    await expect(off.svc.get({ source: "hass", entity: "weather.home" })).rejects.toThrow("not connected");
    expect(() => off.svc.resolve({ source: "hass" })).toThrow("weather.*");
    await expect(off.svc.get({})).rejects.toThrow("Pick a city in Manage > Weather, or connect Home Assistant");
  });
  test("geocode", async () => {
    const r = rig();
    expect(await r.svc.geocode("Hanoi")).toEqual([{ name: "Hanoi", lat: 21.0, lon: 105.8, country: "Vietnam", admin: "Hanoi" }]);
    expect(r.urls[0]).toContain("language=vi");
    expect(await r.svc.geocode("a")).toEqual([]);
    expect(r.urls.length).toBe(1);
  });

describe("auto: Home Assistant connected after the agent started", () => {
  const mkHa = (over: Record<string, any> = {}) => {
    let connected = false;
    let entity: string | null = "weather.forecast_home";
    const ha: any = {
      connected: () => connected, getState: () => undefined, callService: async () => {},
      weatherEntity: async () => (connected ? entity : null),
      weather: async (id: string) => ({ state: "rainy", attributes: { friendly_name: id, temperature: 22 }, hourly: [], daily: [] }),
      ...over,
    };
    return { ha, connect: () => { connected = true; }, disconnect: () => { connected = false; }, setEntity: (e: string | null) => { entity = e; } };
  };

  test("a tile with no entity and no location says what to do, then works once HA connects, and goes back when it disconnects", async () => {
    const r = mkHa();
    const svc = rig(r.ha).svc;
    await expect(svc.get({})).rejects.toThrow("Pick a city in Manage > Weather, or connect Home Assistant");
    r.connect();
    const d = await svc.get({}); // same options, no restart: the HA weather entity is found
    expect(d.source).toBe("hass");
    expect(d.location).toBe("weather.forecast_home");
    r.disconnect();
    await expect(svc.get({})).rejects.toThrow("Pick a city");
  });

  test("HA's weather entity is preferred over the saved location; open-meteo source and an explicit entity keep their meaning", async () => {
    const r = mkHa();
    r.connect();
    const t = rig(r.ha);
    expect((await t.svc.get({ location: loc })).source).toBe("hass");
    expect(t.urls.length).toBe(0);
    expect((await t.svc.get({ source: "open-meteo", location: loc })).source).toBe("open-meteo");
    expect((await t.svc.get({ entity: "weather.other", location: loc })).location).toBe("weather.other");
  });

  test("HA connected but without a weather entity: the saved location, else the hint", async () => {
    const r = mkHa();
    r.connect(); r.setEntity(null);
    const t = rig(r.ha);
    expect((await t.svc.get({ location: loc })).source).toBe("open-meteo");
    await expect(t.svc.get({})).rejects.toThrow("Pick a city");
    // a failing lookup falls back the same way
    const bad = mkHa({ weatherEntity: async () => { throw new Error("boom"); } });
    bad.connect();
    expect((await rig(bad.ha).svc.get({ location: loc })).source).toBe("open-meteo");
  });
});
});
