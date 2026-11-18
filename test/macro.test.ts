import { describe, expect, test } from "bun:test";
import type { Action } from "../src/config";
import { abortableSleep, runMacro, type MacroCtx } from "../src/macro";

function rig(items: Record<string, Action> = {}, failOn?: string) {
  const log: string[] = [];
  const sleeps: number[] = [];
  const ac = new AbortController();
  const ctx: MacroCtx = {
    exec: async (a, d) => {
      log.push(`${a.type}@${d}`);
      if (failOn && a.type === failOn) throw new Error("boom");
      if (a.type === "macro") await runMacro(a.steps, ctx, d);
    },
    item: (p, i) => items[`${p}/${i}`],
    notify: (t) => log.push(`notify:${t}`),
    sleep: async (ms) => { sleeps.push(ms); },
    signal: ac.signal,
  };
  return { ctx, log, sleeps, ac };
}

describe("macro runner", () => {
  test("runs steps in order and maps each to an action", async () => {
    const r = rig();
    await runMacro([
      { kind: "hotkey", keys: "cmd+c" }, { kind: "wait", ms: 200 }, { kind: "type", text: "hi" }, { kind: "open", target: "Safari" },
      { kind: "shell", command: "ls" }, { kind: "media", command: "next" }, { kind: "volume", command: "mute" },
      { kind: "hass", service: "light.turn_on", entityId: "light.a" }, { kind: "notify", text: "xong" },
    ], r.ctx);
    expect(r.log).toEqual(["hotkey@0", "type@0", "open@0", "shell@0", "media@0", "volume@0", "hass@0", "notify:xong"]);
    expect(r.sleeps).toEqual([200]);
  });
  test("stops at the first failing step and names it", async () => {
    const r = rig({}, "type");
    await expect(runMacro([{ kind: "hotkey", keys: "a" }, { kind: "type", text: "x" }, { kind: "open", target: "y" }], r.ctx)).rejects.toThrow("step 2 (type): boom");
    expect(r.log).toEqual(["hotkey@0", "type@0"]);
  });
  test("item steps run another button; page actions are skipped; missing items fail", async () => {
    const r = rig({ "p/a": { type: "shell", command: "x" }, "p/pg": { type: "page", page: "q" } });
    await runMacro([{ kind: "item", pageId: "p", itemId: "a" }, { kind: "item", pageId: "p", itemId: "pg" }], r.ctx);
    expect(r.log).toEqual(["shell@1"]);
    await expect(runMacro([{ kind: "item", pageId: "p", itemId: "zz" }], r.ctx)).rejects.toThrow("button p/zz not found");
  });
  test("nested macros: two levels allowed, a third is refused", async () => {
    const leaf: Action = { type: "shell", command: "leaf" };
    const m2: Action = { type: "macro", steps: [{ kind: "item", pageId: "p", itemId: "leaf" }] };
    const m1: Action = { type: "macro", steps: [{ kind: "item", pageId: "p", itemId: "m2" }] };
    const r = rig({ "p/leaf": leaf, "p/m2": m2, "p/m1": m1 });
    await runMacro([{ kind: "item", pageId: "p", itemId: "m1" }], r.ctx); // top -> m1 (depth 1) -> m2 (depth 2) -> leaf
    expect(r.log).toContain("shell@3");
    const loop: Action = { type: "macro", steps: [{ kind: "item", pageId: "p", itemId: "loop" }] };
    const r2 = rig({ "p/loop": loop });
    await expect(runMacro([{ kind: "item", pageId: "p", itemId: "loop" }], r2.ctx)).rejects.toThrow("nested deeper than 2 levels");
  });
  test("cancellation: an aborted signal stops before the next step and interrupts sleeps", async () => {
    const r = rig();
    r.ac.abort();
    await expect(runMacro([{ kind: "hotkey", keys: "a" }], r.ctx)).rejects.toThrow("cancelled");
    const ac = new AbortController();
    const p = abortableSleep(5000, ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toThrow("cancelled");
    await expect(abortableSleep(5000, ac.signal)).rejects.toThrow("cancelled");
    await abortableSleep(5);
  });
});
