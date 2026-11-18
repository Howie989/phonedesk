import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// setup.sh / uninstall.sh against a temp release directory and a temp install home. launchctl is `echo`, and every
// directory the binary touches is inside the sandbox: never the real ~/.phonedesk, ~/.claude or ~/Library/LaunchAgents.
const root = join(import.meta.dir, "..");
const mac = process.platform === "darwin";
const sandbox = mkdtempSync(join(tmpdir(), "pd-inst-"));
const spawned: number[] = [];
afterAll(() => { for (const pid of spawned) try { process.kill(pid); } catch { /* gone */ } });

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const bunPath = process.execPath;

/** A "release": phonedesk-darwin-arm64/x64 are wrappers that run this checkout's real CLI, plus SHA256SUMS. */
function makeRelease(opts: { tamper?: boolean; omit?: boolean } = {}) {
  const dir = mkdtempSync(join(sandbox, "release-"));
  const lines: string[] = [];
  for (const arch of ["arm64", "x64"]) {
    const f = join(dir, `phonedesk-darwin-${arch}`);
    writeFileSync(f, `#!/bin/bash\nexec "${bunPath}" "${join(root, "src", "index.ts")}" "$@"\n`);
    chmodSync(f, 0o755);
    lines.push(`${opts.tamper ? "0".repeat(64) : sha(f)}  phonedesk-darwin-${arch}`);
  }
  writeFileSync(join(dir, "SHA256SUMS"), (opts.omit ? "" : lines.join("\n")) + "\n");
  return dir;
}

async function freePort(): Promise<number> {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
}

function env(home: string, release: string, extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH!, TMPDIR: sandbox,
    HOME: join(home, "fake-home"), // anything that falls back to $HOME stays in the sandbox too
    PHONEDESK_INSTALL_HOME: home, PHONEDESK_RELEASE_BASE: release, PHONEDESK_LAUNCHCTL: "echo",
    ...extra,
  };
}
const sh = (script: string, args: string[], e: Record<string, string>) => Bun.spawnSync(["bash", join(root, script), ...args], { env: e, stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) });
const out = (r: ReturnType<typeof sh>) => r.stdout.toString() + r.stderr.toString();
const newHome = () => { const h = mkdtempSync(join(sandbox, "home-")); mkdirSync(join(h, "fake-home"), { recursive: true }); return h; };

describe.skipIf(!mac)("setup.sh", () => {
  test("downloads, verifies, installs, starts the agent, prints the phone URL and PIN; running it again updates", async () => {
    const home = newHome();
    const release = makeRelease();
    const port = await freePort();
    // an installed Claude hook that points at an older binary is re-pointed at the new one
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: `'/old/place/phonedesk' hook claude --port ${port} --home '${join(home, ".phonedesk")}' # phonedesk hook`, timeout: 60 }] }] } }));

    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--port", String(port)], env(home, release));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    const bin = join(home, ".phonedesk", "bin", "phonedesk");
    expect(existsSync(bin)).toBe(true);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    expect(text).toContain("matches SHA256SUMS");
    expect(text).toMatch(/phonedesk \d+\.\d+\.\d+/);
    expect(text).toContain(`Manage:     http://localhost:${port}/manage/`);
    const pin = /Pairing PIN: (\d{6})/.exec(text)?.[1];
    expect(pin).toBeDefined();
    expect(text).toMatch(new RegExp(`Phone URL:\\s+http://[^\\s]+:${port}`));
    const pid = Number(readFileSync(join(home, ".phonedesk", "agent.pid"), "utf8"));
    spawned.push(pid);

    // the agent really answers, with that PIN, and its data lives in the sandbox
    const info = await (await fetch(`http://127.0.0.1:${port}/api/pairing`)).json() as any;
    expect(info.pin).toBe(pin);
    expect(existsSync(join(home, ".phonedesk"))).toBe(true);
    const hook = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.PermissionRequest[0].hooks[0].command as string;
    expect(hook).not.toContain("/old/place");
    expect(hook).toContain("hook claude");
    expect(existsSync(join(home, ".claude", "settings.json.phonedesk.bak"))).toBe(true);

    // update: the same command again stops the running agent, replaces the binary and starts a new one
    const port2 = await freePort();
    const r2 = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--port", String(port2)], env(home, release));
    expect(r2.exitCode, out(r2)).toBe(0);
    expect(out(r2)).toContain("replacing phonedesk");
    const pid2 = Number(readFileSync(join(home, ".phonedesk", "agent.pid"), "utf8"));
    spawned.push(pid2);
    expect(pid2).not.toBe(pid);
    await Bun.sleep(300);
    await expect(fetch(`http://127.0.0.1:${port}/api/pairing`)).rejects.toThrow(); // the old one is gone
    expect((await fetch(`http://127.0.0.1:${port2}/api/pairing`)).status).toBe(200);
    expect(existsSync(join(home, ".phonedesk", "bin", ".phonedesk.new"))).toBe(false);
  }, 60_000);

  test("autostart: the launchd plist is written under the install home (launchctl is echo); --no-start leaves the agent off", () => {
    const home = newHome();
    const release = makeRelease();
    const r = sh("setup.sh", ["--yes", "--no-start", "--no-open", "--port", "7533"], env(home, release));
    expect(r.exitCode, out(r)).toBe(0);
    const plist = join(home, "Library", "LaunchAgents", "dev.phonedesk.agent.plist");
    expect(existsSync(plist)).toBe(true);
    expect(readFileSync(plist, "utf8")).toContain("<string>7533</string>");
    expect(readFileSync(plist, "utf8")).toContain(join(home, ".phonedesk"));
    expect(existsSync(join(home, ".phonedesk", "agent.pid"))).toBe(false);
  }, 30_000);

  test("a checksum mismatch is refused and nothing is installed", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--no-start"], env(home, makeRelease({ tamper: true })));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("does not match its SHA256SUMS entry");
    expect(existsSync(join(home, ".phonedesk", "bin"))).toBe(false);
  });

  test("a binary missing from SHA256SUMS is refused", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--no-start"], env(home, makeRelease({ omit: true })));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("is not listed in SHA256SUMS");
    expect(existsSync(join(home, ".phonedesk", "bin"))).toBe(false);
  });

  test("a missing download is a clear error", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-start"], env(home, join(sandbox, "no-such-release")));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("could not download");
  });

  test("--dry-run verifies but changes nothing", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--dry-run", "--yes"], env(home, makeRelease()));
    expect(r.exitCode, out(r)).toBe(0);
    expect(out(r)).toContain("dry run");
    expect(existsSync(join(home, ".phonedesk"))).toBe(false);
    expect(existsSync(join(home, "Library"))).toBe(false);
  });

  test("bad options are errors", () => {
    const home = newHome();
    expect(out(sh("setup.sh", ["--wat"], env(home, makeRelease())))).toContain("unknown option");
    expect(sh("setup.sh", ["--port", "abc"], env(home, makeRelease())).exitCode).not.toBe(0);
    expect(sh("setup.sh", ["--help"], env(home, makeRelease())).stdout.toString()).toContain("--no-autostart");
  });
});

describe.skipIf(!mac)("uninstall.sh", () => {
  test("removes the service, our hooks (with a backup) and the program; keeps data; --purge deletes it", async () => {
    const home = newHome();
    const release = makeRelease();
    mkdirSync(join(home, ".claude"), { recursive: true });
    const other = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] } };
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(other));
    const inst = sh("setup.sh", ["--yes", "--no-start", "--no-open"], env(home, release));
    expect(inst.exitCode, out(inst)).toBe(0);
    const bin = join(home, ".phonedesk", "bin", "phonedesk");
    // install our two hooks through the real code, into the sandbox
    const HI = await import("../src/hooks-install");
    await HI.installHook(join(home, ".claude", "settings.json"), HI.hookCommand("claude", { execPath: bin }));
    await HI.installAskHook(join(home, ".claude", "settings.json"), HI.askHookCommand({ execPath: bin }));
    writeFileSync(join(home, ".phonedesk", "layout.json"), "{}");
    const plist = join(home, "Library", "LaunchAgents", "dev.phonedesk.agent.plist");
    expect(existsSync(plist)).toBe(true);

    const dry = sh("uninstall.sh", ["--dry-run"], env(home, release));
    expect(dry.exitCode).toBe(0);
    expect(existsSync(bin)).toBe(true);

    const r = sh("uninstall.sh", ["--yes"], env(home, release));
    expect(r.exitCode, out(r)).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(join(home, ".phonedesk", "bin"))).toBe(false);
    expect(existsSync(join(home, ".phonedesk", "layout.json"))).toBe(true); // data stays
    expect(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"))).toEqual(other);
    expect(existsSync(join(home, ".claude", "settings.json.phonedesk.bak"))).toBe(true);

    // again, with nothing left: still fine; --purge removes the data
    const again = sh("uninstall.sh", ["--yes"], env(home, release));
    expect(again.exitCode, out(again)).toBe(0);
    const purge = sh("uninstall.sh", ["--yes", "--purge"], env(home, release));
    expect(purge.exitCode, out(purge)).toBe(0);
    expect(existsSync(join(home, ".phonedesk"))).toBe(false);
  }, 60_000);
});
