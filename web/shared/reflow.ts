// Pure placement rules shared by the manage page and the agent's MCP server. No imports: types are structural.

/** Any layout tile: position and size are optional (default 0,0 and 1x1). */
export interface TileLike { id: string; x?: number; y?: number; w?: number; h?: number }
export interface PageLike<T extends TileLike = TileLike> { id: string; columns: number; rows: number; items: T[] }
export interface LayoutLike<P extends PageLike = PageLike> { pages: P[] }
export type ReflowFailure = "outside" | "full" | "not-found";

export interface Rect { x: number; y: number; w: number; h: number }
export type ReflowResult<T extends TileLike = TileLike> = { ok: true; items: T[]; pushed: string[] } | { ok: false; reason: ReflowFailure };

type Grid = { columns: number; rows: number };

const rectOf = (it: TileLike): Rect => ({ x: it.x ?? 0, y: it.y ?? 0, w: it.w ?? 1, h: it.h ?? 1 });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, g: Grid) => r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= g.columns && r.y + r.h <= g.rows;

/**
 * Puts `placed` (an item that already carries its target x/y/w/h) on the page. Tiles it lands on are pushed to the
 * nearest free spot of their own size, in reading order, inside the same page. If any of them has nowhere to go the
 * whole placement is rejected and nothing changes (no overflow to another page).
 */
export function reflowPage<T extends TileLike>(page: PageLike<T>, placed: T): ReflowResult<T> {
  const target = rectOf(placed);
  if (!inside(target, page)) return { ok: false, reason: "outside" };

  const others = page.items.filter((i) => i.id !== placed.id);
  const displaced = others.filter((i) => overlaps(rectOf(i), target));
  const fixed = others.filter((i) => !displaced.includes(i));

  const busy: boolean[][] = Array.from({ length: page.rows }, () => Array<boolean>(page.columns).fill(false));
  const mark = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (busy[y]?.[x] !== undefined) busy[y]![x] = true;
  };
  const free = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (busy[y]![x]) return false;
    return true;
  };
  for (const f of fixed) mark(rectOf(f));
  mark(target);

  // Reading order keeps the pushed tiles in the order the user had them.
  const queue = [...displaced].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const moved = new Map<string, T>();
  for (const d of queue) {
    const r = rectOf(d);
    let best: { x: number; y: number; dist: number } | null = null;
    for (let y = 0; y + r.h <= page.rows; y++) {
      for (let x = 0; x + r.w <= page.columns; x++) {
        if (!free({ x, y, w: r.w, h: r.h })) continue;
        const dist = (x - r.x) ** 2 + (y - r.y) ** 2;
        // Scanning in reading order, so the first of equal distances is the earliest one.
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    }
    if (!best) return { ok: false, reason: "full" };
    mark({ x: best.x, y: best.y, w: r.w, h: r.h });
    moved.set(d.id, { ...d, x: best.x, y: best.y });
  }

  const exists = page.items.some((i) => i.id === placed.id);
  const items = page.items.map((i) => (i.id === placed.id ? placed : (moved.get(i.id) ?? i)));
  if (!exists) items.push(placed);
  return { ok: true, items, pushed: [...moved.keys()] };
}

/** Moves an existing tile. */
export function pageMove<T extends TileLike>(page: PageLike<T>, id: string, x: number, y: number): ReflowResult<T> {
  const it = page.items.find((i) => i.id === id);
  if (!it) return { ok: false, reason: "not-found" };
  return reflowPage(page, { ...it, x, y });
}

/** Resizes an existing tile (optionally moving its corner). */
export function pageResize<T extends TileLike>(page: PageLike<T>, id: string, w: number, h: number, x?: number, y?: number): ReflowResult<T> {
  const it = page.items.find((i) => i.id === id);
  if (!it) return { ok: false, reason: "not-found" };
  return reflowPage(page, { ...it, x: x ?? it.x ?? 0, y: y ?? it.y ?? 0, w, h });
}

/** A new tile dropped at (x, y). `item` need not have a position yet. */
export function pagePlace<T extends TileLike>(page: PageLike<T>, item: T, x: number, y: number): ReflowResult<T> {
  return reflowPage(page, { ...item, x, y });
}

export type LayoutResult<L> = { ok: true; layout: L; pushed: string[] } | { ok: false; reason: ReflowFailure };

function onPage<L extends LayoutLike>(layout: L, pageId: string, fn: (p: L["pages"][number]) => ReflowResult<L["pages"][number]["items"][number]>): LayoutResult<L> {
  const pi = layout.pages.findIndex((p) => p.id === pageId);
  if (pi < 0) return { ok: false, reason: "not-found" };
  const r = fn(layout.pages[pi]!);
  if (!r.ok) return r;
  const pages = layout.pages.map((p, i) => (i === pi ? { ...p, items: r.items } : p));
  return { ok: true, layout: { ...layout, pages }, pushed: r.pushed };
}

/** Adds `item` (or repositions it when its id is already on the page) at cell (x, y). */
export function placeItem<L extends LayoutLike>(layout: L, pageId: string, item: L["pages"][number]["items"][number], x: number, y: number): LayoutResult<L> {
  return onPage(layout, pageId, (p) => pagePlace(p, item, x, y));
}
/** Moves an existing item to cell (x, y), pushing the tiles in the way. */
export function moveItem<L extends LayoutLike>(layout: L, pageId: string, itemId: string, x: number, y: number): LayoutResult<L> {
  return onPage(layout, pageId, (p) => pageMove(p, itemId, x, y));
}
/** Resizes an existing item (optionally moving its top-left corner), pushing the tiles in the way. */
export function resizeItem<L extends LayoutLike>(layout: L, pageId: string, itemId: string, w: number, h: number, x?: number, y?: number): LayoutResult<L> {
  return onPage(layout, pageId, (p) => pageResize(p, itemId, w, h, x, y));
}
