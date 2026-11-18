import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
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
function makeRelease(opts: { tamper?: boolean; omit?: boolean; gz?: "good" | "bad-sum" | "no-file" | "bad-content"; variant?: string } = {}) {
  const dir = mkdtempSync(join(sandbox, "release-"));
  const lines: string[] = [];
  for (const arch of ["arm64", "x64"]) {
    const f = join(dir, `phonedesk-darwin-${arch}`);
    writeFileSync(f, `#!/bin/bash\nexec "${bunPath}" "${join(root, "src", "index.ts")}" "$@"\n${opts.variant ? `# ${opts.variant}\n` : ""}`);
    chmodSync(f, 0o755);
    lines.push(`${opts.tamper ? "0".repeat(64) : sha(f)}  phonedesk-darwin-${arch}`);
    if (opts.gz) {
      const g = `${f}.gz`;
      // "bad-content": a valid, correctly summed gzip whose content is not the listed binary
      writeFileSync(g, gzipSync(opts.gz === "bad-content" ? Buffer.from("#!/bin/bash\necho phonedesk 9.9.9\n") : readFileSync(f)));
      lines.push(`${opts.gz === "bad-sum" ? "0".repeat(64) : sha(g)}  phonedesk-darwin-${arch}.gz`);
      if (opts.gz === "no-file") rmSync(g);
    }
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
    PATH: process.env.PATH!, TMPDIR: sandbox, SHELL: "/bin/zsh", // the PATH step picks the rc file from $SHELL: pin it so CI (bash) matches
    HOME: join(home, "fake-home"), // anything that falls back to $HOME stays in the sandbox too
    PHONEDESK_INSTALL_HOME: home, PHONEDESK_RELEASE_BASE: release, PHONEDESK_LAUNCHCTL: "echo",
    ...extra,
  };
}
const sh = (script: string, args: string[], e: Record<string, string>) => Bun.spawnSync(["bash", join(root, script), ...args], { env: e, stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) });
const out = (r: ReturnType<typeof sh>) => r.stdout.toString() + r.stderr.toString();
const newHome = () => { const h = mkdtempSync(join(sandbox, "home-")); mkdirSync(join(h, "fake-home"), { recursive: true }); return h; };

describe.skipIf(!mac)("setup.sh: compressed assets", () => {
  const run = (release: string, home = newHome()) => ({ home, r: sh("setup.sh", ["--yes", "--no-autostart", "--no-start", "--no-open"], env(home, release)) });
  test("a release with gzip assets: downloads the .gz with its size, verifies it, unpacks, verifies the binary too", () => {
    const { home, r } = run(makeRelease({ gz: "good" }));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toMatch(/Fetching phonedesk-darwin-(arm64|x64)\.gz \(\d+ MB\)/);
    expect(text.match(/checksum ok/g)?.length).toBe(2); // the .gz, then the unpacked binary
    expect(existsSync(join(home, ".phonedesk", "bin", "phonedesk"))).toBe(true);
  });
  test("over http: the size comes from HEAD, and a download cut in the middle continues with a Range request", async () => {
    const release = makeRelease({ gz: "good" });
    const hits: string[] = [];
    let cut = false;
    const server = createServer((req, res) => {
      const name = (req.url ?? "").slice(1);
      const f = join(release, name);
      if (!existsSync(f)) { res.writeHead(404).end("no"); return; }
      const body = readFileSync(f);
      const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ""));
      hits.push(`${req.method} ${name}${range ? " " + req.headers.range : ""}`);
      if (req.method === "HEAD") { res.writeHead(200, { "content-length": body.length }).end(); return; }
      if (range) { res.writeHead(206, { "content-length": body.length - Number(range[1]), "content-range": `bytes ${range[1]}-${body.length - 1}/${body.length}` }).end(body.subarray(Number(range[1]))); return; }
      if (name.endsWith(".gz") && !cut) {
        cut = true; // promise everything, deliver half, then drop the connection
        res.writeHead(200, { "content-length": body.length });
        res.write(body.subarray(0, Math.floor(body.length / 2)));
        setTimeout(() => res.socket?.destroy(), 50);
        return;
      }
      res.writeHead(200, { "content-length": body.length }).end(body);
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as any).port as number;
    try {
      const home = newHome();
      // env() carries PHONEDESK_INSTALL_HOME: a temp home
      const r = await Bun.spawn(["bash", join(root, "setup.sh"), "--yes", "--no-autostart", "--no-start", "--no-open"], { env: env(home, `http://127.0.0.1:${port}`), stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) });
      const text = (await new Response(r.stdout).text()) + (await new Response(r.stderr).text());
      expect(await r.exited, text).toBe(0);
      expect(text).toMatch(/Fetching phonedesk-darwin-(arm64|x64)\.gz \(\d+ MB\)/);
      expect(text).toContain("resuming from where it stopped");
      expect(hits.some((h) => h.startsWith("HEAD ") && h.includes(".gz"))).toBe(true);
      expect(hits.some((h) => /GET .*\.gz bytes=\d+-/.test(h))).toBe(true);
      expect(existsSync(join(home, ".phonedesk", "bin", "phonedesk"))).toBe(true);
    } finally { server.close(); }
  });
  test("an older release without gzip assets still installs from the plain binary", () => {
    const { r } = run(makeRelease());
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).not.toContain(".gz");
    expect(text).toMatch(/Fetching phonedesk-darwin-(arm64|x64) \(\d+ MB\)/);
    expect(text.match(/checksum ok/g)?.length).toBe(1);
  });
  test("the .gz is listed but cannot be downloaded: falls back to the plain binary", () => {
    const { r } = run(makeRelease({ gz: "no-file" }));
    const text = out(r);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain("falling back to the uncompressed binary");
  });
  test("a .gz that does not match SHA256SUMS is refused, nothing is installed", () => {
    const { home, r } = run(makeRelease({ gz: "bad-sum" }));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".phonedesk", "bin", "phonedesk"))).toBe(false);
  });
  test("an intact .gz whose content is not the listed binary is refused after unpacking", () => {
    const { home, r } = run(makeRelease({ gz: "bad-content" }));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".phonedesk", "bin", "phonedesk"))).toBe(false);
  });
});

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
    expect(text).toContain("checksum ok");
    expect(text).toMatch(/phonedesk \d+\.\d+\.\d+/);
    expect(text).toContain(`http://localhost:${port}/manage/`);
    const pin = /PIN\s+(\d{6})/.exec(text)?.[1];
    expect(pin).toBeDefined();
    expect(text).toMatch(new RegExp(`Phone\\s+http://[^\\s]+:${port}`));
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
    const r2 = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--force", "--port", String(port2)], env(home, release)); // --force: the same release again
    expect(r2.exitCode, out(r2)).toBe(0);
    expect(out(r2)).toContain("upgrading from phonedesk");
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
    expect(out(r)).toContain("checksum mismatch");
    expect(existsSync(join(home, ".phonedesk", "bin"))).toBe(false);
  });

  test("a binary missing from SHA256SUMS is refused", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-autostart", "--no-open", "--no-start"], env(home, makeRelease({ omit: true })));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("has no entry in SHA256SUMS");
    expect(existsSync(join(home, ".phonedesk", "bin"))).toBe(false);
  });

  test("a missing download is a clear error", () => {
    const home = newHome();
    const r = sh("setup.sh", ["--yes", "--no-start"], env(home, join(sandbox, "no-such-release")));
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("could not fetch");
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
    expect(out(sh("setup.sh", ["--wat"], env(home, makeRelease())))).toContain("unrecognised flag");
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

describe.skipIf(!mac)("setup.sh: finding the latest release when GitHub misbehaves", () => {
  // a local stand-in for github.com + api.github.com + the release downloads
  function githubStandIn(opts: { failFirst?: number; redirectWorks?: boolean; apiTag?: string | null; status?: number }) {
    const release = makeRelease({ gz: "good" });
    let n = 0;
    const hits: string[] = [];
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      hits.push(`${req.method} ${url}`);
      if (n++ < (opts.failFirst ?? 0)) { res.writeHead(503).end("busy"); return; }
      if (url === "/howznguyen/phonedesk/releases/latest") {
        if (opts.redirectWorks === false) { res.writeHead(opts.status ?? 503).end("no"); return; }
        res.writeHead(302, { location: "/howznguyen/phonedesk/releases/tag/v9.9.9" }).end(); return;
      }
      if (url === "/howznguyen/phonedesk/releases/tag/v9.9.9") { res.writeHead(200).end("page"); return; }
      if (url === "/repos/howznguyen/phonedesk/releases/latest") {
        if (opts.apiTag) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: opts.apiTag, name: "x" })); return; }
        res.writeHead(opts.status ?? 503).end("no"); return;
      }
      const m = /^\/howznguyen\/phonedesk\/releases\/download\/v9\.9\.9\/(.+)$/.exec(url);
      if (m && existsSync(join(release, m[1]!))) { const b = readFileSync(join(release, m[1]!)); res.writeHead(200, { "content-length": b.length }).end(req.method === "HEAD" ? undefined : b); return; }
      res.writeHead(404).end("no");
    });
    return new Promise<{ base: string; hits: string[]; close: () => void }>((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${(server.address() as any).port}`, hits, close: () => server.close() })));
  }
  const run = async (gh: { base: string }, extra: Record<string, string> = {}, args: string[] = []) => {
    const home = newHome();
    const e = { ...env(home, "x"), PHONEDESK_GITHUB_URL: gh.base + "/", PHONEDESK_API_URL: gh.base, PHONEDESK_RETRY_SECONDS: "1", ...extra } as Record<string, string>;
    delete e.PHONEDESK_RELEASE_BASE;
    const p = Bun.spawn(["bash", join(root, "setup.sh"), "--yes", "--no-autostart", "--no-start", "--no-open", ...args], { env: e, stdout: "pipe", stderr: "pipe", stdin: new Blob([""]) }); // env: PHONEDESK_INSTALL_HOME (via env()) keeps this in the sandbox
    const text = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { code: await p.exited, text, home };
  };
  test("the redirect lookup answers 5xx for a while: it retries and installs", async () => {
    const gh = await githubStandIn({ failFirst: 2, apiTag: null });
    try {
      const r = await run(gh);
      expect(r.code, r.text).toBe(0);
      expect(r.text).toContain("release v9.9.9");
    } finally { gh.close(); }
  }, 60_000);
  test("the redirect keeps failing: it falls back to api.github.com tag_name", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: "v9.9.9" });
    try {
      const r = await run(gh);
      expect(r.code, r.text).toBe(0);
      expect(r.text).toContain("release v9.9.9");
      expect(gh.hits.some((h) => h.includes("/repos/") && h.includes("/releases/latest"))).toBe(true);
    } finally { gh.close(); }
  }, 60_000);
  test("both fail: the error says what failed and suggests --version / PHONEDESK_VERSION; nothing is installed", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: null, status: 404 });
    try {
      const r = await run(gh);
      expect(r.code).not.toBe(0);
      expect(r.text).toContain("look up the latest release");
      expect(r.text).toContain("--version");
      expect(r.text).toContain("PHONEDESK_VERSION");
      expect(r.text).toContain("retrying"); // it did retry
      expect(existsSync(join(r.home, ".phonedesk", "bin", "phonedesk"))).toBe(false);
    } finally { gh.close(); }
  }, 60_000);
  test("PHONEDESK_VERSION skips the lookup entirely", async () => {
    const gh = await githubStandIn({ redirectWorks: false, apiTag: null });
    try {
      const r = await run(gh, { PHONEDESK_VERSION: "9.9.9" });
      expect(r.code, r.text).toBe(0);
      expect(gh.hits.some((h) => h.includes("/releases/latest"))).toBe(false);
    } finally { gh.close(); }
  }, 60_000);

});

describe.skipIf(!mac)("setup.sh / uninstall.sh: PATH and the port check", () => {
  const base = ["--yes", "--no-autostart", "--no-open"];
  test("PATH: the marked line goes into the shell rc files, once; uninstall removes it and keeps the rest", () => {
    const home = newHome();
    writeFileSync(join(home, ".zshrc"), "alias ll='ls -l'\n# phonedesk is great\nexport FOO=1");
    const rel = makeRelease();
    for (let i = 0; i < 2; i++) {
      const r = sh("setup.sh", [...base, "--no-start"], env(home, rel));
      expect(r.exitCode, out(r)).toBe(0);
      if (i === 0) expect(out(r)).toMatch(/New terminal windows will find phonedesk[\s\S]*source ~?\/?.*\.zshrc/);
    }
    const rc = readFileSync(join(home, ".zshrc"), "utf8");
    expect(rc.match(/\.phonedesk\/bin:\$PATH" # phonedesk/g)?.length).toBe(1); // idempotent
    expect(rc).toContain("export FOO=1\nexport PATH="); // newline added before our line
    const u = sh("uninstall.sh", ["--yes"], env(home, rel));
    expect(u.exitCode, out(u)).toBe(0);
    const after = readFileSync(join(home, ".zshrc"), "utf8");
    expect(after).toBe("alias ll='ls -l'\n# phonedesk is great\nexport FOO=1\n"); // only our line is gone
    expect(existsSync(join(home, ".zshrc.phonedesk.bak"))).toBe(true);
  });
  test("PATH: with ~/.local/bin on PATH a symlink is made (no rc edit); uninstall removes it", () => {
    const home = newHome();
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const rel = makeRelease();
    const e = env(home, rel, { PATH: `${join(home, ".local", "bin")}:${process.env.PATH}` });
    const r = sh("setup.sh", [...base, "--no-start"], e);
    expect(r.exitCode, out(r)).toBe(0);
    expect(readlinkSync(join(home, ".local", "bin", "phonedesk"))).toBe(join(home, ".phonedesk", "bin", "phonedesk"));
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(out(r)).toContain("Try: phonedesk doctor");
    const u = sh("uninstall.sh", ["--yes"], e);
    expect(u.exitCode, out(u)).toBe(0);
    expect(existsSync(join(home, ".local", "bin", "phonedesk"))).toBe(false);
  });
  test("--no-path changes nothing", () => {
    const home = newHome();
    const r = sh("setup.sh", [...base, "--no-start", "--no-path"], env(home, makeRelease()));
    expect(r.exitCode, out(r)).toBe(0);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(existsSync(join(home, ".bash_profile"))).toBe(false);
  });
  test("a listener on the port: setup says who holds it and stops before starting anything", async () => {
    if (Bun.spawnSync(["which", "lsof"], { env: { PATH: process.env.PATH!, HOME: join(sandbox, "fake-home") } }).exitCode !== 0) return; // HOME: sandbox
    const holder = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      const home = newHome();
      const r = sh("setup.sh", [...base, "--port", String(holder.port)], env(home, makeRelease()));
      const text = out(r);
      expect(r.exitCode).not.toBe(0);
      expect(text).toContain(`port ${holder.port} is taken by process ${process.pid}`);
      expect(text).toContain("--port");
      expect(existsSync(join(home, ".phonedesk", "agent.pid"))).toBe(false);
    } finally { holder.stop(true); }
  });
  test("the health check must be answered by the agent just installed", async () => {
    const home = newHome();
    const port = await freePort();
    const r = sh("setup.sh", [...base, "--port", String(port)], env(home, makeRelease()));
    const text = out(r);
    const pid = Number(readFileSync(join(home, ".phonedesk", "agent.pid"), "utf8").trim());
    if (pid) spawned.push(pid);
    expect(r.exitCode, text).toBe(0);
    expect(text).toContain(`agent is up on port ${port}`);
  }, 60_000);
});

describe.skipIf(!mac)("setup.sh: running it again does not redo what is done", () => {
  const sum = (t: string) => /Program\s+(.+)\n\s*PATH\s+(.+)\n\s*Service\s+(.+)/.exec(t)?.slice(1, 4).map((x) => x.trim());
  test("same release, agent running: no download, no questions, the same agent keeps running, summary says 'already set'", async () => {
    const home = newHome();
    const release = makeRelease({ gz: "good" });
    const port = await freePort();
    const args = ["--yes", "--no-open", "--no-autostart", "--port", String(port)];
    const r1 = sh("setup.sh", args, env(home, release));
    expect(r1.exitCode, out(r1)).toBe(0);
    expect(sum(out(r1))).toEqual(["installed", "installed", "skipped"]);
    const pidfile = join(home, ".phonedesk", "agent.pid");
    const pid = Number(readFileSync(pidfile, "utf8")); spawned.push(pid);
    const bin = join(home, ".phonedesk", "bin", "phonedesk");
    const before = statSync(bin).mtimeMs;
    const rc = readFileSync(join(home, ".zshrc"), "utf8");
    const t0 = Date.now();
    const r2 = sh("setup.sh", args, env(home, release));
    const text = out(r2);
    expect(r2.exitCode, text).toBe(0);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(text).toMatch(/PhoneDesk \d+\.\d+\.\d+ is up to date/);
    expect(text).not.toContain("Fetching");
    expect(text).not.toContain("[Y/n]");
    expect(text).toContain("already on PATH");
    expect(text).toContain("agent already running");
    expect(sum(text)).toEqual(["already set", "already set", "skipped"]);
    expect(statSync(bin).mtimeMs).toBe(before);
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe(rc);
    expect(Number(readFileSync(pidfile, "utf8"))).toBe(pid); // not restarted
    expect((await fetch(`http://127.0.0.1:${port}/api/pairing`)).status).toBe(200);
    // --force reinstalls anyway
    const r3 = sh("setup.sh", [...args, "--force"], env(home, release));
    expect(r3.exitCode, out(r3)).toBe(0);
    expect(out(r3)).toContain("Fetching");
    expect(sum(out(r3))?.[0]).toMatch(/^updated/);
    spawned.push(Number(readFileSync(pidfile, "utf8")));
  }, 90_000);
  test("the launchd service: kept when it runs this program on this port; rewritten when the port changes", () => {
    const home = newHome();
    const release = makeRelease();
    const args = ["--yes", "--no-open", "--no-start"];
    const e = env(home, release);
    const r1 = sh("setup.sh", [...args, "--port", "7541"], e);
    expect(sum(out(r1))?.[2]).toBe("installed");
    const plist = join(home, "Library", "LaunchAgents", "dev.phonedesk.agent.plist");
    const same = readFileSync(plist, "utf8");
    const r2 = sh("setup.sh", [...args, "--port", "7541"], e);
    expect(out(r2)).toContain("service already registered");
    expect(sum(out(r2))?.[2]).toBe("already set");
    expect(readFileSync(plist, "utf8")).toBe(same);
    const r3 = sh("setup.sh", [...args, "--port", "7542"], e);
    expect(sum(out(r3))?.[2]).toBe("updated");
    expect(readFileSync(plist, "utf8")).toContain("<string>7542</string>");
  }, 90_000);
  test("a tampered install is not 'up to date'; a different release is an upgrade", () => {
    const home = newHome();
    const args = ["--yes", "--no-open", "--no-start", "--no-autostart"];
    expect(sh("setup.sh", args, env(home, makeRelease())).exitCode).toBe(0);
    const bin = join(home, ".phonedesk", "bin", "phonedesk");
    // a different release (another file, another sum): downloaded and replaced
    const up = sh("setup.sh", args, env(home, makeRelease({ variant: "v2" })));
    expect(up.exitCode, out(up)).toBe(0);
    expect(out(up)).not.toContain("up to date");
    expect(sum(out(up))?.[0]).toMatch(/^updated \(/);
    // the installed file changed behind our back: reinstalled even though the release is the same
    const rel = makeRelease({ variant: "v2" });
    writeFileSync(bin, readFileSync(bin, "utf8") + "# edited\n");
    const fix = sh("setup.sh", args, env(home, rel));
    expect(out(fix)).not.toContain("up to date");
    expect(fix.exitCode, out(fix)).toBe(0);
    expect(readFileSync(bin, "utf8")).not.toContain("# edited");
  }, 90_000);
  test("an install without the .release marker (older setup) is reinstalled once, then it is up to date", () => {
    const home = newHome();
    const rel = makeRelease();
    const args = ["--yes", "--no-open", "--no-start", "--no-autostart"];
    expect(sh("setup.sh", args, env(home, rel)).exitCode).toBe(0);
    rmSync(join(home, ".phonedesk", "bin", ".release"));
    expect(out(sh("setup.sh", args, env(home, rel)))).not.toContain("up to date");
    expect(out(sh("setup.sh", args, env(home, rel)))).toContain("up to date");
  }, 90_000);
});
