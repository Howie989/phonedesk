/**
 * Three-way merge used before saving, so a stale management tab cannot wipe changes made elsewhere
 * (another tab, the MCP tools, a PUT from a script).
 *   base   = the layout this page last loaded or saved
 *   mine   = what this page wants to save
 *   theirs = what the agent has now
 * A field this page did not change keeps the agent's value; a field it changed wins. Done per top-level key and, for
 * `theme`, per theme field, so unknown fields round-trip and `theme.language` is never dropped by an unrelated edit.
 */
type Obj = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function mergeFields(base: Obj, mine: Obj, theirs: Obj): Obj {
  const out: Obj = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const v = same(mine[k], base[k]) ? theirs[k] : mine[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function mergeLayouts<L extends object>(base: L, mine: L, theirs: L): L {
  const b = base as Obj, m = mine as Obj, t = theirs as Obj;
  const out = mergeFields(b, m, t);
  if (isObj(m.theme) || isObj(t.theme)) {
    const theme = mergeFields(isObj(b.theme) ? b.theme : {}, isObj(m.theme) ? m.theme : {}, isObj(t.theme) ? t.theme : {});
    if (Object.keys(theme).length) out.theme = theme;
    else delete out.theme;
  }
  return out as L;
}
