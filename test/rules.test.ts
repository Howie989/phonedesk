import { describe, expect, test } from "bun:test";
import type { Rule } from "../src/automation";
import { RuleEngine, inTimeWindow } from "../src/rules";

function rig(rules: Rule[], start = new Date(2026, 10, 17, 10, 0, 0).getTime()) {
  let t = start;
  const log: any[] = [];
  const eng = new RuleEngine({
    rules: () => rules, now: () => t,
    actions: {
      gotoPage: (pageId, o) => log.push(["goto", pageId, o.countdown, o.reason, o.revert]),
      gotoRevert: (id) => log.push(["revert", id]),
      notify: (text, level, id) => log.push(["notify", text, level, id]),
      themeMode: (m) => log.push(["theme", m]),
      runItem: (p, i) => { log.push(["run", p, i]); },
    },
  });
  return { eng, log, advance: (ms: number) => { t += ms; }, at: () => t };
}
const rule = (id: string, when: any, then: any[], extra: any = {}): Rule => ({ id, name: id, enabled: true, when, then, ...extra });

describe("RuleEngine", () => {
  test("edge-triggered: fires when the condition turns true, not while it stays true", () => {
    const r = rig([rule("m", { kind: "media-playing" }, [{ kind: "goto-page", pageId: "media", countdown: 5 }])]);
    r.eng.setMedia(false);
    expect(r.log).toEqual([]);
    r.eng.setMedia(true);
    expect(r.log).toEqual([["goto", "media", 5, "m", false]]);
    r.eng.setMedia(true); r.eng.tick();
    expect(r.log.length).toBe(1);
  });

  test("60 s cooldown after a run; fires again after it", () => {
    const r = rig([rule("m", { kind: "media-playing" }, [{ kind: "notify", text: "hi", level: "warn" }])]);
    r.eng.setMedia(true);
    r.advance(1000); r.eng.setMedia(false);
    r.advance(1000); r.eng.setMedia(true); // 2 s later: in cooldown
    expect(r.log.length).toBe(1);
    r.advance(1000); r.eng.setMedia(false);
    r.advance(61_000); r.eng.setMedia(true);
    expect(r.log.length).toBe(2);
    expect(r.log[1]).toEqual(["notify", "hi", "warn", "m"]);
  });

  test("revert goes back when the condition ends; theme-mode override is dropped; revert only for goto rules", () => {
    const r = rig([
      rule("g", { kind: "media-playing" }, [{ kind: "goto-page", pageId: "media" }], { revert: true }),
      rule("t", { kind: "media-playing" }, [{ kind: "theme-mode", mode: "dark" }]),
      rule("n", { kind: "media-playing" }, [{ kind: "notify", text: "x" }], { revert: true }),
    ]);
    r.eng.setMedia(true);
    expect(r.log.map((l) => l[0])).toEqual(["goto", "theme", "notify"]);
    r.log.length = 0;
    r.eng.setMedia(false);
    expect(r.log).toEqual([["revert", "g"], ["theme", null]]);
    r.log.length = 0;
    r.eng.setMedia(false);
    expect(r.log).toEqual([]);
  });

  test("ai-waiting with and without provider; run-item", () => {
    const r = rig([
      rule("any", { kind: "ai-waiting" }, [{ kind: "run-item", pageId: "p", itemId: "b" }]),
      rule("cx", { kind: "ai-waiting", provider: "codex" }, [{ kind: "notify", text: "codex" }]),
    ]);
    r.eng.setAiInput(["claude"]);
    expect(r.log).toEqual([["run", "p", "b"]]);
    r.eng.setAiInput(["claude", "codex"]);
    expect(r.log[1]).toEqual(["notify", "codex", "info", "cx"]);
  });

  test("pending prompts count only with includePrompts", () => {
    const r = rig([
      rule("plain", { kind: "ai-waiting" }, [{ kind: "notify", text: "needs you" }]),
      rule("withp", { kind: "ai-waiting", includePrompts: true }, [{ kind: "notify", text: "prompt" }]),
    ]);
    r.eng.setAiPrompts(["claude"]);
    expect(r.log).toEqual([["notify", "prompt", "info", "withp"]]);
    r.eng.setAiInput(["claude"]);
    expect(r.log[1]).toEqual(["notify", "needs you", "info", "plain"]);
  });

  test("cpu-above with forSec waits for the duration", () => {
    const r = rig([rule("c", { kind: "cpu-above", percent: 80, forSec: 10 }, [{ kind: "notify", text: "cpu" }]), rule("c0", { kind: "cpu-above", percent: 95 }, [{ kind: "notify", text: "hot" }])]);
    r.eng.setCpu(85);
    expect(r.log).toEqual([]);
    r.advance(5000); r.eng.setCpu(90);
    expect(r.log).toEqual([]);
    r.advance(6000); r.eng.setCpu(90);
    expect(r.log.map((l) => l[1])).toEqual(["cpu"]);
    r.eng.setCpu(96);
    expect(r.log.map((l) => l[1])).toEqual(["cpu", "hot"]);
    r.eng.setCpu(20); // a dip resets the clock
    r.advance(120_000);
    r.eng.setCpu(90);
    r.advance(5000); r.eng.setCpu(90);
    expect(r.log.length).toBe(2);
  });

  test("quota-above, push comparisons, hass-state", () => {
    const r = rig([
      rule("q", { kind: "quota-above", provider: "claude", percent: 80 }, [{ kind: "notify", text: "quota" }]),
      rule("p", { kind: "push", key: "temp", op: ">", value: 30 }, [{ kind: "notify", text: "hot" }]),
      rule("e", { kind: "push", key: "mode", value: "Away" }, [{ kind: "notify", text: "away" }]),
      rule("h", { kind: "hass-state", entityId: "light.a", state: "on" }, [{ kind: "notify", text: "light" }]),
    ]);
    r.eng.setQuota({ claude: 80, codex: 99 });
    expect(r.log).toEqual([]);
    r.eng.setQuota({ claude: 81 });
    r.eng.setPush("temp", 29); r.eng.setPush("temp", 31);
    r.eng.setPush("mode", "away");
    r.eng.setHass("light.a", "off"); r.eng.setHass("light.a", "on");
    expect(r.log.map((l) => l[1])).toEqual(["quota", "hot", "away", "light"]);
    r.eng.setPush("temp", undefined);
    expect(r.eng.facts.push.temp).toBeUndefined();
  });

  test("time-between with midnight crossing and days; evaluated by tick", () => {
    const day = (h: number, m = 0, d = 17) => new Date(2026, 10, d, h, m);
    expect(inTimeWindow({ from: "09:00", to: "17:00" }, day(10))).toBe(true);
    expect(inTimeWindow({ from: "09:00", to: "17:00" }, day(17))).toBe(false);
    expect(inTimeWindow({ from: "22:00", to: "06:00" }, day(23))).toBe(true);
    expect(inTimeWindow({ from: "22:00", to: "06:00" }, day(5, 59))).toBe(true);
    expect(inTimeWindow({ from: "22:00", to: "06:00" }, day(12))).toBe(false);
    expect(inTimeWindow({ from: "08:00", to: "08:00" }, day(8))).toBe(false);
    const tue = day(10).getDay(); // 2026-11-17 is a Tuesday
    expect(inTimeWindow({ from: "09:00", to: "17:00", days: [tue] }, day(10))).toBe(true);
    expect(inTimeWindow({ from: "09:00", to: "17:00", days: [(tue + 1) % 7] }, day(10))).toBe(false);
    expect(inTimeWindow({ from: "22:00", to: "06:00", days: [tue] }, day(2, 0, 18))).toBe(true); // the window began Tuesday evening

    const r = rig([rule("t", { kind: "time-between", from: "10:30", to: "11:00" }, [{ kind: "notify", text: "time" }])]);
    r.eng.tick();
    expect(r.log).toEqual([]);
    r.advance(31 * 60_000); r.eng.tick();
    expect(r.log.length).toBe(1);
  });

  test("idle counts from the last press (or from start) on any phone", () => {
    const r = rig([rule("i", { kind: "idle", minutes: 5 }, [{ kind: "goto-page", pageId: "clock" }], { revert: true })]);
    r.advance(4 * 60_000); r.eng.tick();
    expect(r.log).toEqual([]);
    r.eng.pressed();
    r.advance(4 * 60_000); r.eng.tick();
    expect(r.log).toEqual([]);
    r.advance(60_000); r.eng.tick();
    expect(r.log.length).toBe(1);
    r.eng.pressed(); // someone pressed: back to where they were
    expect(r.log.at(-1)).toEqual(["revert", "i"]);
  });

  test("disabled rules never fire and end their effects; removed rules are forgotten", () => {
    const rules = [rule("m", { kind: "media-playing" }, [{ kind: "theme-mode", mode: "light" }])];
    const r = rig(rules);
    r.eng.setMedia(true);
    expect(r.log).toEqual([["theme", "light"]]);
    rules[0]!.enabled = false;
    r.eng.tick();
    expect(r.log.at(-1)).toEqual(["theme", null]);
    r.eng.setMedia(false); r.eng.setMedia(true);
    expect(r.log.length).toBe(2);
    rules.length = 0;
    r.eng.tick();
  });

  test("a throwing action does not stop the other actions", () => {
    let t = 0;
    const log: string[] = [];
    const eng = new RuleEngine({ now: () => t, rules: () => [rule("x", { kind: "media-playing" }, [{ kind: "notify", text: "a" }, { kind: "theme-mode", mode: "dark" }])], actions: {
      gotoPage() {}, gotoRevert() {}, notify: () => { throw new Error("bad"); }, themeMode: (m) => log.push(String(m)), runItem() {},
    } });
    const orig = console.error; console.error = () => {};
    eng.setMedia(true);
    console.error = orig;
    expect(log).toEqual(["dark"]);
  });
});
