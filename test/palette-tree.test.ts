import { describe, expect, test } from "bun:test";
import { setLanguage } from "../web/manage/src/lib/i18n";
import { buildTree, highlight, matches } from "../web/manage/src/lib/palette-tree";
import { appCategory, entityEntry, STATIC_ENTRIES } from "../web/manage/src/lib/palette";

const ent = (id: string, name: string, area: string | undefined, state = "on") => entityEntry({ id, name, domain: id.split(".")[0]!, area, state });

describe("palette tree", () => {
  test("widgets split into the agreed sub-categories", () => {
    const w = STATIC_ENTRIES.filter((e) => e.group === "widget");
    const t = buildTree("widget", "Widget", w);
    expect(t.children.map((c) => c.label).sort()).toEqual(["AI", "Media", "Other", "System", "Time"]);
    expect(t.count).toBe(w.length);
  });

  test("Nhà: scenes first, areas alphabetical, no-area last, domains inside", () => {
    const t = buildTree("home", "Home", [
      ent("light.kitchen", "Kitchen light", "Kitchen"), ent("switch.fan", "Fan", undefined), ent("scene.movie", "Movie", "Kitchen"), ent("light.lounge", "Lounge light", "Lounge"),
      ent("binary_sensor.kitchen_motion", "Kitchen motion", "Kitchen"),
    ]);
    expect(t.children.map((c) => c.label)).toEqual(["Scenes & scripts", "Kitchen", "Lounge", "No area"]);
    const kitchen = t.children[1]!;
    expect(kitchen.children.map((c) => c.label).sort()).toEqual(["Lights", "Presence / motion"]);
    expect(kitchen.count).toBe(2);
  });

  test("app categories: raw macOS ids and English labels map, unknown goes to Other", () => {
    expect(appCategory("public.app-category.developer-tools")).toBe("Developer tools");
    expect(appCategory("Music")).toBe("Music");
    expect(appCategory(undefined)).toBe("Other");
    expect(appCategory("weird")).toBe("Other");
  });

  test("search ignores diacritics and looks at label, tags and path; highlight marks the hit", () => {
    const e = STATIC_ENTRIES.find((x) => x.key === "k-shot")!;
    expect(matches(e, "capt", "Shortcuts")).toBe(true);
    expect(matches(e, "system", "Shortcuts")).toBe(true);
    expect(matches(e, "zzz", "Shortcuts")).toBe(false);
    expect(highlight("Capture region", "capt").map((p) => [p.text, p.hit])).toEqual([["Capt", true], ["ure region", false]]);
  });

  test("Vietnamese search still finds entries when the UI language is Vietnamese", () => {
    setLanguage("vi");
    try {
      const e = STATIC_ENTRIES.find((x) => x.key === "k-shot")!;
      expect(matches(e, "chup", "Phím tắt")).toBe(true);
      expect(matches(e, "he thong", "Phím tắt")).toBe(true);
      expect(matches(e, "capt", "Phím tắt")).toBe(true);
      expect(highlight("Chụp vùng", "chup").map((p) => [p.text, p.hit])).toEqual([["Chụp", true], [" vùng", false]]);
    } finally {
      setLanguage("en");
    }
  });
});
