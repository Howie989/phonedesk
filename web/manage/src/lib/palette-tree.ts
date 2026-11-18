import { getLanguage, t } from "./i18n";
import { APP_CATEGORIES, NO_AREA, SCENE_GROUP, entryHint, entryLabel, type PaletteEntry, type PaletteGroup } from "./palette";

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

export interface TreeNode {
  /** Stable id, e.g. "home/Kitchen/Lights". */
  key: string;
  label: string;
  entries: PaletteEntry[];
  children: TreeNode[];
  /** Entries in this node and below. */
  count: number;
}

/** Alphabetical compare in the UI language; `t` makes the translated names sort the way they read. */
const cmp = (a: string, b: string) => t(a).localeCompare(t(b), getLanguage());

/** Order of sub-categories under a group: fixed lists first, "No area" last, the rest alphabetical (or first-seen). */
function orderChildren(group: PaletteGroup, labels: string[]): string[] {
  if (group === "app") return [...labels].sort((a, b) => APP_CATEGORIES.indexOf(a) - APP_CATEGORIES.indexOf(b));
  if (group === "home") {
    return [...labels].sort((a, b) => (a === SCENE_GROUP ? -1 : b === SCENE_GROUP ? 1 : a === NO_AREA ? 1 : b === NO_AREA ? -1 : cmp(a, b)));
  }
  return labels;
}

/** Builds the two-level (Home: three-level) tree for one group from already filtered entries. */
export function buildTree(group: PaletteGroup, label: string, entries: PaletteEntry[]): TreeNode {
  const root: TreeNode = { key: group, label, entries: [], children: [], count: entries.length };
  const seen = new Map<string, TreeNode>();
  for (const e of entries) {
    let node = root;
    let key: string = group;
    for (const part of e.path ?? []) {
      key = `${key}/${part}`;
      let child = seen.get(key);
      if (!child) {
        child = { key, label: part, entries: [], children: [], count: 0 };
        seen.set(key, child);
        node.children.push(child);
      }
      child.count++;
      node = child;
    }
    node.entries.push(e);
  }
  const sortAll = (n: TreeNode, g: PaletteGroup, depth: number) => {
    if (depth === 0) {
      const order = orderChildren(g, n.children.map((c) => c.label));
      n.children.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    } else if (g === "home" || g === "app") {
      n.children.sort((a, b) => cmp(a.label, b.label));
    }
    if (g === "home" || g === "app") n.entries.sort((a, b) => a.label.localeCompare(b.label, getLanguage()));
    n.children.forEach((c) => sortAll(c, g, depth + 1));
  };
  sortAll(root, group, 0);
  return root;
}

export function matches(e: PaletteEntry, q: string, groupLabel: string): boolean {
  if (!q) return true;
  // English text and its translation are both searchable, so "chup" and "capture" find the same entry in either language.
  const path = e.path ?? [];
  const hay = norm(`${e.label} ${entryLabel(e)} ${e.hint ?? ""} ${entryHint(e)} ${e.tags ?? ""} ${e.tags ? t(e.tags) : ""} ${groupLabel} ${path.join(" ")} ${path.map((x) => t(x)).join(" ")}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** Splits `text` into [plain, hit, plain, hit…] around every query word (diacritic-insensitive). */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  const words = q.split(/\s+/).filter(Boolean);
  const n = norm(text);
  if (!words.length || n.length !== text.length) return [{ text, hit: false }];
  const mark = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = n.indexOf(w); i >= 0; i = n.indexOf(w, i + 1)) for (let j = i; j < i + w.length; j++) mark[j] = true;
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === mark[i]) last.text += text[i];
    else out.push({ text: text[i]!, hit: mark[i]! });
  }
  return out;
}
