import { describe, expect, test } from "bun:test";
import { defaultLayout, validateLayout } from "../src/config";
import { isIconName } from "../web/shared/icons";

const withItem = (extra: Record<string, unknown>) => {
  const l: any = defaultLayout();
  l.pages[0].items[3] = { ...l.pages[0].items[3], ...extra };
  return l;
};

describe("validateLayout", () => {
  test("default layout is valid and every button icon exists in the shared set", () => {
    const l = validateLayout(defaultLayout());
    for (const p of l.pages) for (const i of p.items) if (i.kind === "button") expect(isIconName(i.icon)).toBe(true);
  });

  test("theme customisation fields round-trip", () => {
    const l: any = defaultLayout();
    l.theme = { mode: "light", accent: "#38bdf8", tileStyle: "outline", iconScale: 1.4, showLabels: false, text: "#fafafa", radius: 20 };
    expect(validateLayout(l).theme).toEqual(l.theme);
  });

  test("per-item style fields round-trip and false hideLabel is dropped", () => {
    const it = validateLayout(withItem({ style: "solid", textColor: "#000", hideLabel: true })).pages[0].items[3] as any;
    expect([it.style, it.textColor, it.hideLabel]).toEqual(["solid", "#000", true]);
    expect((validateLayout(withItem({ hideLabel: false })).pages[0].items[3] as any).hideLabel).toBeUndefined();
  });

  test("rejects bad customisation values", () => {
    const bad: [string, Record<string, unknown>][] = [
      ["style", { style: "neon" }],
      ["textColor", { textColor: "red;}body{x" }],
      ["hideLabel", { hideLabel: "yes" }],
    ];
    for (const [field, extra] of bad) expect(() => validateLayout(withItem(extra))).toThrow(field);
    const l: any = defaultLayout();
    l.theme = { iconScale: 5 };
    expect(() => validateLayout(l)).toThrow("iconScale");
    l.theme = { showLabels: 1 };
    expect(() => validateLayout(l)).toThrow("showLabels");
  });

  test("tile span is limited by the page columns", () => {
    expect(() => validateLayout(withItem({ w: 9 }))).toThrow("w must be");
  });

  test("theme.orientation is checked", () => {
    const l: any = defaultLayout();
    l.theme = { orientation: "portrait" };
    expect(validateLayout(l).theme?.orientation).toBe("portrait");
    l.theme = { orientation: "sideways" };
    expect(() => validateLayout(l)).toThrow("orientation");
  });
});

describe("grid placement", () => {
  const page = (items: any[], extra: Record<string, unknown> = { columns: 8, rows: 3 }) => ({ version: 1, pages: [{ id: "p", name: "P", ...extra, items }] });
  const btn = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "button", label: id, ...extra });

  test("default pages are 8x3 x3 and 8x2 with explicit positions", () => {
    const l = validateLayout(defaultLayout());
    expect(l.pages.map((p) => `${p.columns}x${p.rows}`)).toEqual(["8x3", "8x3", "8x3", "8x2"]);
    for (const p of l.pages) for (const i of p.items) expect(typeof i.x === "number" && typeof i.y === "number").toBe(true);
  });

  test("items without x/y flow into free cells around fixed ones", () => {
    const l = validateLayout(page([btn("a", { x: 0, y: 0, w: 2 }), btn("b"), btn("c", { x: 3, y: 0 }), btn("d")]));
    const pos = Object.fromEntries(l.pages[0].items.map((i) => [i.id, `${i.x},${i.y}`]));
    expect(pos).toEqual({ a: "0,0", b: "2,0", c: "3,0", d: "4,0" });
  });

  test("rejects overlap, out of bounds, half positions and a full grid", () => {
    expect(() => validateLayout(page([btn("a", { x: 0, y: 0, w: 2 }), btn("b", { x: 1, y: 0 })]))).toThrow('"b" overlaps "a"');
    expect(() => validateLayout(page([btn("a", { x: 7, y: 0, w: 2 })]))).toThrow("does not fit");
    expect(() => validateLayout(page([btn("a", { x: 0, y: 3 })]))).toThrow("does not fit");
    expect(() => validateLayout(page([btn("a", { x: 1 })]))).toThrow("both x and y");
    expect(() => validateLayout(page([btn("a"), btn("b"), btn("c")], { columns: 2, rows: 1 }))).toThrow('no free space for item "c"');
  });

  test("legacy pages without rows get rows from their content", () => {
    const l = validateLayout(page([btn("a"), btn("b"), btn("c"), btn("d"), btn("e")], { columns: 4 }));
    expect(l.pages[0].rows).toBe(2);
    expect(l.pages[0].items[4]).toMatchObject({ x: 0, y: 1 });
  });
});

describe("AI widgets", () => {
  const page = (items: any[]) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 8, rows: 3, items }] });
  test("quota widget needs a valid provider", () => {
    expect(validateLayout(page([{ id: "q", kind: "widget", widget: "quota", provider: "codex" }])).pages[0].items[0]).toMatchObject({ provider: "codex" });
    expect(() => validateLayout(page([{ id: "q", kind: "widget", widget: "quota" }]))).toThrow("needs a provider");
    expect(() => validateLayout(page([{ id: "q", kind: "widget", widget: "quota", provider: "gpt" }]))).toThrow("provider must be");
  });
});

describe("icons (Tabler + brand marks)", () => {
  test("old Lucide and Reicon names in saved layouts are renamed on load", () => {
    const l = validateLayout({ version: 1, pages: [{ id: "p", name: "P", columns: 6, rows: 1, items: [
      { id: "a", kind: "button", label: "a", icon: "skip-back" },
      { id: "b", kind: "button", label: "b", icon: "house" },
      { id: "c", kind: "button", label: "c", icon: "🎵" },
      { id: "d", kind: "button", label: "d", icon: "github" },
      { id: "e", kind: "button", label: "e", icon: "skip-prev" },
      { id: "f", kind: "button", label: "f", icon: "volume-high" },
    ] }] });
    expect(l.pages[0]!.items.map((i: any) => i.icon)).toEqual(["player-skip-back", "home", "🎵", "brand-github", "player-skip-back", "volume"]);
  });
});

describe("clock options", () => {
  const page = (clock: unknown) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 2, items: [{ id: "c", kind: "widget", widget: "clock", w: 2, clock }] }] });
  test("styles and options round-trip", () => {
    const c = { style: "world", seconds: false, hour12: true, showDate: true, timeZone: "Asia/Singapore", zones: ["Asia/Tokyo", "Europe/London"], label: "Home" };
    expect((validateLayout(page(c)).pages[0]!.items[0] as any).clock).toEqual(c);
  });
  test("rejects unknown style, zone and too many zones", () => {
    expect(() => validateLayout(page({ style: "sundial" }))).toThrow("clock.style");
    expect(() => validateLayout(page({ timeZone: "Mars/Olympus" }))).toThrow("not a known time zone");
    expect(() => validateLayout(page({ zones: ["UTC", "UTC", "UTC", "UTC", "UTC"] }))).toThrow("up to 4");
  });
  test("clock options are dropped on other widgets", () => {
    const l = validateLayout({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 1, items: [{ id: "c", kind: "widget", widget: "cpu", clock: { style: "flip" } }] }] });
    expect((l.pages[0]!.items[0] as any).clock).toBeUndefined();
  });
});

describe("metric chart options", () => {
  const page = (widget: string, metric: unknown) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 1, items: [{ id: "m", kind: "widget", widget, w: 2, metric }] }] });
  test("round-trip per widget", () => {
    expect((validateLayout(page("memory", { chart: "donut", window: 300, showDelta: false })).pages[0]!.items[0] as any).metric).toEqual({ chart: "donut", window: 300, showDelta: false });
    expect((validateLayout(page("network", { chart: "bars" })).pages[0]!.items[0] as any).metric).toEqual({ chart: "bars" });
  });
  test("charts that need 0-100 are refused for network/load, donut only for memory", () => {
    expect(() => validateLayout(page("network", { chart: "gauge" }))).toThrow("chart for network");
    expect(() => validateLayout(page("load", { chart: "ring" }))).toThrow("chart for load");
    expect(() => validateLayout(page("cpu", { chart: "donut" }))).toThrow("chart for cpu");
    expect(() => validateLayout(page("cpu", { window: 42 }))).toThrow("window");
  });
});

describe("icon forms", () => {
  const page = (icon: string) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 1, items: [{ id: "a", kind: "button", label: "a", icon }] }] });
  test("app, image, emoji and catalog names are accepted", () => {
    for (const icon of ["app:com.apple.Safari", "img:0123456789abcdef", "🎧", "rocket", "airplane"]) expect((validateLayout(page(icon)).pages[0]!.items[0] as any).icon).toBe(icon);
  });
  test("malformed app/img icons are refused", () => {
    expect(() => validateLayout(page("app:../../etc"))).toThrow("not a valid app icon");
    expect(() => validateLayout(page("img:../x.png"))).toThrow("not a valid image icon");
  });
});

describe("quota options", () => {
  const page = (quota: unknown) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 2, items: [{ id: "q", kind: "widget", widget: "quota", provider: "claude", w: 2, h: 2, quota }] }] });
  test("round-trip", () => {
    const q = { chart: "history", windows: "main", showReset: false, account: "claude:abc" };
    expect((validateLayout(page(q)).pages[0]!.items[0] as any).quota).toEqual(q);
  });
  test("rejects unknown chart and windows", () => {
    expect(() => validateLayout(page({ chart: "pie" }))).toThrow("quota.chart");
    expect(() => validateLayout(page({ windows: "some" }))).toThrow("quota.windows");
  });
});

describe("sound actions", () => {
  const page = (action: unknown) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 1, items: [{ id: "s", kind: "button", label: "Bruh", action }] }] });
  test("round-trip", () => {
    const a = { type: "sound", sound: "snd:0123456789abcdef", on: "both", volume: 80, mode: "toggle" };
    expect((validateLayout(page(a)).pages[0]!.items[0] as any).action).toEqual(a);
    expect((validateLayout(page({ type: "sound-stop" })).pages[0]!.items[0] as any).action).toEqual({ type: "sound-stop" });
  });
  test("rejects paths and bad options", () => {
    expect(() => validateLayout(page({ type: "sound", sound: "../../etc/passwd" }))).toThrow("uploaded sound");
    expect(() => validateLayout(page({ type: "sound", sound: "snd:0123456789abcdef", on: "tv" }))).toThrow("mac, phone or both");
    expect(() => validateLayout(page({ type: "sound", sound: "snd:0123456789abcdef", volume: 150 }))).toThrow("volume");
  });
});

describe("Home Assistant", () => {
  const page = (item: any) => ({ version: 1, pages: [{ id: "p", name: "P", columns: 4, rows: 1, items: [{ id: "h", ...item }] }] });
  test("entity widget and hass action round-trip", () => {
    expect((validateLayout(page({ kind: "widget", widget: "entity", entity: { id: "light.living_room", name: "Kitchen", show: "toggle" } })).pages[0]!.items[0] as any).entity).toEqual({ id: "light.living_room", name: "Kitchen", show: "toggle" });
    const a = { type: "hass", service: "scene.turn_on", entityId: "scene.xem_phim", data: { transition: 2 } };
    expect((validateLayout(page({ kind: "button", label: "Phim", action: a })).pages[0]!.items[0] as any).action).toEqual(a);
  });
  test("rejects malformed ids", () => {
    expect(() => validateLayout(page({ kind: "widget", widget: "entity", entity: { id: "Light Bep" } }))).toThrow("domain.object_id");
    expect(() => validateLayout(page({ kind: "widget", widget: "entity" }))).toThrow("needs entity.id");
    expect(() => validateLayout(page({ kind: "button", label: "x", action: { type: "hass", service: "rm -rf" } }))).toThrow("domain.service");
  });
});
