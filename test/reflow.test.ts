import { describe, expect, test } from "bun:test";
import { moveItem, pagePlace, placeItem, resizeItem, type LayoutLike, type PageLike, type TileLike } from "../web/shared/reflow";

const t = (id: string, x: number, y: number, w = 1, h = 1): TileLike => ({ id, x, y, ...(w > 1 || h > 1 ? { w, h } : {}) });
const page = (columns: number, rows: number, items: TileLike[]): PageLike => ({ id: "p", columns, rows, items });
const lay = (columns: number, rows: number, items: TileLike[]): LayoutLike => ({ pages: [page(columns, rows, items)] });
const at = (r: { ok: true; layout: LayoutLike }, id: string) => r.layout.pages[0]!.items.find((i) => i.id === id)!;

describe("reflow rules", () => {
  test("a free target just moves the tile", () => {
    const r = moveItem(lay(4, 2, [t("a", 0, 0)]), "p", "a", 3, 1);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(at(r, "a")).toMatchObject({ x: 3, y: 1 }); expect(r.pushed).toEqual([]); }
  });

  test("outside the grid or unknown ids are rejected", () => {
    expect(moveItem(lay(4, 2, [t("a", 0, 0, 2)]), "p", "a", 3, 0)).toEqual({ ok: false, reason: "outside" });
    expect(placeItem(lay(4, 2, []), "p", t("n", 0, 0, 1, 3), 0, 0)).toEqual({ ok: false, reason: "outside" });
    expect(moveItem(lay(4, 2, []), "p", "zz", 0, 0)).toEqual({ ok: false, reason: "not-found" });
    expect(moveItem(lay(4, 2, [t("a", 0, 0)]), "nope", "a", 1, 0)).toEqual({ ok: false, reason: "not-found" });
  });

  test("a displaced tile goes to the nearest free cell", () => {
    const r = moveItem(lay(4, 1, [t("a", 0, 0), t("b", 1, 0)]), "p", "a", 1, 0);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(at(r, "a")).toMatchObject({ x: 1 }); expect(at(r, "b")).toMatchObject({ x: 0 }); expect(r.pushed).toEqual(["b"]); }
  });

  test("three tiles displaced into the free right half keep their order", () => {
    const r = placeItem(lay(4, 2, [t("a", 0, 0, 2, 1), t("b", 0, 1), t("c", 1, 1)]), "p", t("n", 0, 0, 2, 2), 0, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(at(r, "a")).toMatchObject({ x: 2, y: 0 });
      expect(at(r, "b")).toMatchObject({ x: 2, y: 1 });
      expect(at(r, "c")).toMatchObject({ x: 3, y: 1 });
    }
  });

  test("a full page rejects the drop and leaves the input untouched", () => {
    const l = lay(2, 2, [t("a", 0, 0), t("b", 1, 0), t("c", 0, 1), t("d", 1, 1)]);
    const before = JSON.stringify(l);
    expect(placeItem(l, "p", t("n", 0, 0), 0, 0)).toEqual({ ok: false, reason: "full" });
    expect(JSON.stringify(l)).toBe(before);
  });

  test("resizing pushes neighbours away or is rejected", () => {
    const grow = resizeItem(lay(3, 1, [t("a", 0, 0), t("b", 1, 0)]), "p", "a", 2, 1);
    expect(grow.ok).toBe(true);
    if (grow.ok) { expect(at(grow, "a")).toMatchObject({ x: 0, w: 2 }); expect(at(grow, "b")).toMatchObject({ x: 2 }); }
    expect(resizeItem(lay(2, 1, [t("a", 0, 0), t("b", 1, 0)]), "p", "a", 2, 1)).toEqual({ ok: false, reason: "full" });
  });

  test("a big tile is never split", () => {
    const ok = placeItem(lay(4, 2, [t("w", 0, 0, 2, 2)]), "p", t("n", 0, 0), 0, 0);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(at(ok, "w")).toMatchObject({ x: 1, y: 0, w: 2, h: 2 });
    expect(placeItem(lay(4, 2, [t("w", 0, 0, 2, 2), t("x", 2, 0), t("y", 3, 1)]), "p", t("n", 0, 0), 0, 0)).toEqual({ ok: false, reason: "full" });
  });

  test("moving onto itself changes nothing; only the touched page changes; extra fields survive", () => {
    const r = moveItem(lay(3, 1, [t("a", 1, 0), t("b", 2, 0)]), "p", "a", 1, 0);
    expect(r.ok && r.pushed).toEqual([]);
    const l = { pages: [page(2, 1, [{ ...t("a", 0, 0), label: "keep" } as TileLike]), { ...page(2, 1, []), id: "q" }], theme: 1 };
    const m = moveItem(l, "p", "a", 1, 0);
    expect(m.ok && (m.layout.pages[0]!.items[0] as TileLike & { label: string }).label).toBe("keep");
    expect(m.ok && m.layout.theme).toBe(1);
    expect(pagePlace(page(2, 1, []), t("z", 0, 0), 1, 0).ok).toBe(true);
  });
});
