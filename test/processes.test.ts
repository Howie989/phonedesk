import { describe, expect, test } from "bun:test";
import { parsePs, parseProcessesRequest, topProcesses, topProcessesFrom } from "../src/processes";

const PS = `  PID  %CPU    RSS COMM
    1   0.0   1000 /sbin/launchd
  100  45.5  50000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  200   2,5 900000 /usr/bin/node
  300  12.0  20000 -zsh
garbage line
`;

describe("processes", () => {
  test("parsePs handles spaces in paths, basename, rss KB -> bytes", () => {
    const p = parsePs(PS);
    expect(p.map((x) => x.name)).toEqual(["launchd", "Google Chrome", "node", "-zsh"]);
    expect(p[1]).toEqual({ pid: 100, cpu: 45.5, mem: 50000 * 1024, name: "Google Chrome" });
    expect(p[2]!.cpu).toBe(2.5);
  });
  test("sorting and limit", () => {
    const p = parsePs(PS);
    expect(topProcessesFrom(p, "cpu", 2).map((x) => x.pid)).toEqual([100, 300]);
    expect(topProcessesFrom(p, "mem", 1).map((x) => x.pid)).toEqual([200]);
    expect(topProcessesFrom(p, "cpu", 500).length).toBe(4);
  });
  test("request validation", () => {
    expect(parseProcessesRequest({ sort: "cpu" })).toEqual({ sort: "cpu", limit: 10 });
    expect(parseProcessesRequest({ sort: "mem", limit: 50 })).toEqual({ sort: "mem", limit: 50 });
    for (const bad of [{ sort: "pid" }, { sort: "cpu", limit: 51 }, { sort: "cpu", limit: 0 }, { sort: "cpu", limit: 1.5 }, { sort: "cpu", limit: "5" }, {}]) {
      expect("error" in parseProcessesRequest(bad)).toBe(true);
    }
  });
  test("topProcesses uses the injected runner", async () => {
    let argv: string[] = [];
    const r = await topProcesses("cpu", 1, async (a) => { argv = a; return PS; });
    if (process.platform !== "win32") expect(argv).toEqual(["ps", "-Ao", "pid,pcpu,rss,comm"]);
    expect(r[0]!.name).toBe("Google Chrome");
  });
  test("smoke: real ps returns processes", async () => {
    if (process.platform === "win32") return;
    const r = await topProcesses("cpu", 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.pid).toBeGreaterThan(0);
  });
});
