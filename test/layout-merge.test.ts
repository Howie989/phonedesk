import { describe, expect, test } from "bun:test";
import { mergeLayouts } from "../web/manage/src/lib/layout-merge";

describe("mergeLayouts (stale management tab)", () => {
  const base = { pages: [{ id: "a" }], theme: { mode: "dark", tileStyle: "tint" } };
  test("an external theme.language survives an unrelated edit", () => {
    const mine = { ...base, pages: [{ id: "a" }, { id: "b" }] };
    const theirs = { ...base, theme: { ...base.theme, language: "vi" } };
    const out = mergeLayouts(base, mine, theirs) as any;
    expect(out.theme.language).toBe("vi");
    expect(out.pages.length).toBe(2);
  });
  test("my theme edit wins for that field only, other external fields stay", () => {
    const mine = { ...base, theme: { ...base.theme, mode: "light" } };
    const theirs = { ...base, theme: { ...base.theme, accent: "#22d3ee", language: "vi" } };
    expect((mergeLayouts(base, mine, theirs) as any).theme).toEqual({ mode: "light", tileStyle: "tint", accent: "#22d3ee", language: "vi" });
  });
  test("a field I removed stays removed; nothing external means mine", () => {
    const mine = { pages: base.pages, theme: { mode: "dark" } };
    expect((mergeLayouts(base, mine, base) as any).theme).toEqual({ mode: "dark" });
  });
});
