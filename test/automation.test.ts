import { describe, expect, test } from "bun:test";
import { validateLayout } from "../src/config";

const base = (items: any[] = [], extra: Record<string, unknown> = {}) => ({
  version: 1,
  pages: [
    { id: "home", name: "Home", columns: 8, rows: 3, items },
    { id: "ai", name: "AI", columns: 8, rows: 3, items: [] },
  ],
  ...extra,
});

describe("weather / value / notifications widgets", () => {
  test("weather options round-trip and validate", () => {
    const weather = { source: "open-meteo", location: { name: "Hanoi", lat: 21.03, lon: 105.85 }, show: "daily", units: "metric" };
    const l = validateLayout(base([{ id: "w", kind: "widget", widget: "weather", w: 2, weather }]));
    expect((l.pages[0]!.items[0] as any).weather).toEqual(weather);
    expect(() => validateLayout(base([{ id: "w", kind: "widget", widget: "weather", weather: { entity: "sensor.temp" } }]))).toThrow("weather.* entity");
    expect(() => validateLayout(base([{ id: "w", kind: "widget", widget: "weather", weather: { location: { name: "x", lat: 200, lon: 0 } } }]))).toThrow("lat");
  });
  test("value widget needs a valid push key", () => {
    expect((validateLayout(base([{ id: "v", kind: "widget", widget: "value", push: { key: "ci.build", label: "Build", unit: "%" } }])).pages[0]!.items[0] as any).push).toEqual({ key: "ci.build", label: "Build", unit: "%" });
    expect(() => validateLayout(base([{ id: "v", kind: "widget", widget: "value", push: { key: "Bad Key!" } }]))).toThrow("push.key");
    expect(() => validateLayout(base([{ id: "v", kind: "widget", widget: "value" }]))).toThrow("with a key");
  });
  test("notifications widget needs no options", () => {
    expect(validateLayout(base([{ id: "n", kind: "widget", widget: "notifications", w: 2, h: 2 }])).pages[0]!.items[0]).toMatchObject({ widget: "notifications" });
  });
});

describe("macro actions", () => {
  const btn = (steps: unknown) => base([{ id: "m", kind: "button", label: "Meeting", action: { type: "macro", steps } }]);
  test("steps round-trip", () => {
    const steps = [
      { kind: "hotkey", keys: "cmd+space" }, { kind: "type", text: "zoom" }, { kind: "wait", ms: 500 },
      { kind: "hotkey", keys: "return" }, { kind: "volume", command: "mute" }, { kind: "hass", service: "light.turn_off", entityId: "light.den_ban" },
      { kind: "item", pageId: "home", itemId: "x" }, { kind: "notify", text: "Joining the meeting" },
    ];
    expect((validateLayout(btn(steps)).pages[0]!.items[0] as any).action.steps).toEqual(steps);
  });
  test("limits: empty, too many steps, long waits, unknown kind", () => {
    expect(() => validateLayout(btn([]))).toThrow("non-empty");
    expect(() => validateLayout(btn(Array.from({ length: 21 }, () => ({ kind: "wait", ms: 1 }))))).toThrow("at most 20");
    expect(() => validateLayout(btn([{ kind: "wait", ms: 10000 }, { kind: "wait", ms: 10000 }, { kind: "wait", ms: 10000 }, { kind: "wait", ms: 1000 }]))).toThrow("30 s");
    expect(() => validateLayout(btn([{ kind: "teleport" }]))).toThrow("not supported");
  });
});

describe("rules", () => {
  const rule = (r: any) => base([], { rules: [{ id: "r1", name: "AI needs me", ...r }] });
  test("a rule round-trips with defaults", () => {
    const l = validateLayout(rule({ when: { kind: "ai-waiting" }, then: [{ kind: "goto-page", pageId: "ai", countdown: 3 }], revert: true }));
    expect(l.rules).toEqual([{ id: "r1", name: "AI needs me", enabled: true, when: { kind: "ai-waiting" }, then: [{ kind: "goto-page", pageId: "ai", countdown: 3 }], revert: true }]);
  });
  test("every trigger kind validates", () => {
    const whens = [
      { kind: "media-playing" }, { kind: "media-stopped" }, { kind: "cpu-above", percent: 90, forSec: 30 },
      { kind: "quota-above", provider: "claude", percent: 80 }, { kind: "time-between", from: "22:00", to: "06:30", days: [1, 2, 3, 4, 5] },
      { kind: "push", key: "doorbell", op: "=", value: "ring" }, { kind: "hass-state", entityId: "binary_sensor.bep_co_nguoi", state: "on" }, { kind: "idle", minutes: 10 },
    ];
    for (const when of whens) expect(validateLayout(rule({ when, then: [{ kind: "notify", text: "x" }] })).rules![0]!.when).toEqual(when);
  });
  test("bad rules are refused", () => {
    expect(() => validateLayout(rule({ when: { kind: "ai-waiting" }, then: [{ kind: "goto-page", pageId: "nope" }] }))).toThrow('page "nope" does not exist');
    expect(() => validateLayout(rule({ when: { kind: "time-between", from: "25:00", to: "06:00" }, then: [{ kind: "notify", text: "x" }] }))).toThrow("HH:MM");
    expect(() => validateLayout(rule({ when: { kind: "ai-waiting" }, then: [] }))).toThrow("1-5 actions");
    expect(() => validateLayout(base([], { rules: [{ id: "a", when: { kind: "idle", minutes: 5 }, then: [{ kind: "notify", text: "x" }] }, { id: "a", when: { kind: "idle", minutes: 5 }, then: [{ kind: "notify", text: "x" }] }] }))).toThrow("duplicate rule");
  });
});
