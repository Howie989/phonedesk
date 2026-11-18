import type { Item, Layout, Page } from "../config";
import { t } from "../i18n";

const CELL = 9;

/** Short label of an item for the grid: the button label (or icon), the widget kind (or provider). */
export function shortLabel(it: Item): string {
  if (it.kind === "widget") return it.widget === "quota" && it.provider ? `quota:${it.provider}` : it.widget;
  return it.label || (it.icon ? it.icon.replace(/^app:/, "") : t("(button)"));
}

const fit = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + "~" : s);

/**
 * One page as a text grid. Every cell is 9 characters wide: the item label in its top-left cell, `~` in the other cells
 * it covers, `.` for a free cell. A legend with ids, positions and sizes follows.
 */
export function pageGrid(page: Page): string {
  const rows = page.rows;
  const cols = page.columns;
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(`${"".padEnd(CELL / 2 - 1)}.${"".padEnd(CELL / 2)}`.slice(0, CELL).padEnd(CELL)));
  const owner: (string | undefined)[][] = Array.from({ length: rows }, () => new Array(cols).fill(undefined));
  for (const it of page.items) {
    const x = it.x ?? 0, y = it.y ?? 0, w = it.w ?? 1, h = it.h ?? 1;
    for (let r = y; r < Math.min(rows, y + h); r++) {
      for (let c = x; c < Math.min(cols, x + w); c++) {
        owner[r]![c] = it.id;
        grid[r]![c] = r === y && c === x ? fit(shortLabel(it), CELL - 2).padEnd(CELL - 2).padStart(CELL - 1).padEnd(CELL) : "~".repeat(CELL);
      }
    }
  }
  const border = "+" + new Array(cols).fill("-".repeat(CELL)).join("+") + "+";
  const lines = [`Page "${page.name}" (id: ${page.id}) ${cols} columns x ${rows} rows`, border];
  for (let r = 0; r < rows; r++) {
    lines.push("|" + grid[r]!.map((cell, c) => {
      // inside one tile, hide the vertical divider so spans read as one block
      return cell;
    }).join("|") + "|");
    lines.push(border);
  }
  lines.push(`Items (${page.items.length}), x,y = top-left cell (0-based), size = columns x rows:`);
  for (const it of page.items) {
    const kind = it.kind === "widget" ? `widget:${it.widget}` : it.action ? `button:${it.action.type}` : "button";
    lines.push(`  ${it.id}  ${kind}  "${shortLabel(it)}"  at ${it.x ?? 0},${it.y ?? 0}  ${it.w ?? 1}x${it.h ?? 1}`);
  }
  const used = page.items.reduce((n, it) => n + (it.w ?? 1) * (it.h ?? 1), 0);
  lines.push(`Fill: ${used}/${cols * rows} cells (${Math.round((used * 100) / (cols * rows))}%)`);
  return lines.join("\n");
}

export function layoutGrid(layout: Layout, pageId?: string): string {
  const pages = pageId ? layout.pages.filter((p) => p.id === pageId) : layout.pages;
  return pages.map(pageGrid).join("\n\n");
}
