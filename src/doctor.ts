import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "./i18n";
import { platform as osPlatform } from "./platform";
import { idleSeconds as winIdle, windowStation as winStation } from "./platform/win32/ffi";
import { SERVICE_LABEL, commandInstance, defaultProgram, hookTargets, repointCommand, sameInstance, type Instance } from "./service";
import { HOOK_EVENT, ASK_EVENT, HOOK_MARKER, ASK_MARKER, type HookTool } from "./hooks-install";
import { readFile } from "node:fs/promises";
import type { HassStatus } from "./hass/client";

/**
 * `phonedesk doctor`: what macOS lets PhoneDesk do. TCC attributes a permission to the RESPONSIBLE process: the phonedesk
 * binary under the LaunchAgent, the terminal app when started from a terminal. So these checks must run inside the
 * running agent (GET /api/doctor). Nothing here ever triggers a permission prompt, except `request()` which the user asks for.
 */
export type DoctorStatus = "ok" | "missing" | "denied" | "unknown" | "n/a";
export interface DoctorItem {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  fix?: { text: string; settingsUrl?: string };
}
export interface DoctorReport {
  version: string;
  exe: string;
  asService: boolean;
  platform: string;
  items: DoctorItem[];
}

export type AutomationState = "granted" | "denied" | "not-asked" | "not-running" | "unknown";

export interface Probes {
  platform: NodeJS.Platform;
  exe: string;
  /** What our hook commands should run: [exe] for the compiled binary, [bun, index.ts] from source. */
  program: string[];
  version: string;
  /** Started by launchd as dev.phonedesk.agent (so macOS attributes permissions to the phonedesk binary). */
  asService: boolean;
  /** Runs a command and returns its exit code and stdout+stderr. Never throws. */
  run(argv: string[]): Promise<{ code: number; out: string }>;
  /** AXIsProcessTrusted(): null when it cannot be asked. */
  axTrusted(): boolean | null;
  /** AEDeterminePermissionToAutomateTarget(askUserIfNeeded=false). */
  automation(bundleId: string): AutomationState;
  /** The prompting variants, only for an explicit request: AXIsProcessTrustedWithOptions(prompt) / AEDetermine...(ask=true). */
  requestAccessibility(): boolean | null;
  requestAutomation(bundleId: string): AutomationState;
  installed(bundleId: string): boolean;
  which(name: string): string | null;
  hookFiles(): Partial<Record<HookTool, string>>;
  /** Windows: the window station of this process ("WinSta0" = the interactive desktop) and seconds since the last input. */
  desktop(): { station: string | null; idle: number | null };
  /** Windows: does the PowerShell helper answer? */
  helperPing(): Promise<boolean>;
  fileExists(path: string): boolean;
  claudeCredentialsFile(): string;
}

export interface DoctorCtx {
  /** The agent's Home Assistant client status (undefined: not available). */
  hass?: HassStatus | null;
  /** Result of the last Claude usage read: ok, or why not. */
  claude?: { ok: boolean; error?: string; pending?: boolean } | null;
  instance: Instance;
}

const SETTINGS = (pane: string) => `x-apple.systempreferences:com.apple.preference.security?${pane}`;
export const PANES = {
  accessibility: SETTINGS("Privacy_Accessibility"),
  automation: SETTINGS("Privacy_Automation"),
  localNetwork: SETTINGS("Privacy_LocalNetwork"),
  firewall: "x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall",
} as const;

export const AUTOMATION_TARGETS = [
  { id: "automation-system-events", name: "System Events", bundle: "com.apple.systemevents", why: "key presses, typing and volume tiles" },
  { id: "automation-music", name: "Music", bundle: "com.apple.Music", why: "the Now Playing tile and media keys for Music" },
  { id: "automation-spotify", name: "Spotify", bundle: "com.spotify.client", why: "the Now Playing tile and media keys for Spotify" },
] as const;

const who = (p: Probes) => (p.asService ? t("the phonedesk program") : t("the terminal app you started PhoneDesk from"));

function accessibility(p: Probes): DoctorItem {
  const title = t("Accessibility");
  if (p.platform !== "darwin") return { id: "accessibility", title, status: "n/a", detail: t("macOS only") };
  const ok = p.axTrusted();
  if (ok === null) return { id: "accessibility", title, status: "unknown", detail: t("could not ask macOS") };
  if (ok) return { id: "accessibility", title, status: "ok", detail: t("granted to {who}", { who: who(p) }) };
  return {
    id: "accessibility", title, status: "missing", detail: t("not granted to {who}: key press and typing tiles will not work", { who: who(p) }),
    fix: { text: t("Open System Settings > Privacy & Security > Accessibility and turn {who} on. Run `phonedesk doctor --request accessibility` to make it appear in the list.", { who: p.asService ? "phonedesk" : t("your terminal app") }), settingsUrl: PANES.accessibility },
  };
}

function automation(p: Probes, tg: (typeof AUTOMATION_TARGETS)[number]): DoctorItem {
  const title = t("Automation: {app}", { app: tg.name });
  if (p.platform !== "darwin") return { id: tg.id, title, status: "n/a", detail: t("macOS only") };
  if (tg.bundle !== "com.apple.systemevents" && !p.installed(tg.bundle)) return { id: tg.id, title, status: "n/a", detail: t("{app} is not installed", { app: tg.name }) };
  const s = p.automation(tg.bundle);
  const fix = { text: t("Open System Settings > Privacy & Security > Automation and allow {who} to control {app}.", { who: p.asService ? "phonedesk" : t("your terminal app"), app: tg.name }), settingsUrl: PANES.automation };
  switch (s) {
    case "granted": return { id: tg.id, title, status: "ok", detail: t("allowed (used for {why})", { why: t(tg.why) }) };
    case "denied": return { id: tg.id, title, status: "denied", detail: t("denied: {why} will not work", { why: t(tg.why) }), fix };
    case "not-asked": return { id: tg.id, title, status: "missing", detail: t("not asked yet: macOS asks the first time a tile needs it"), fix: { ...fix, text: t("Press a tile that uses {app}, or run `phonedesk doctor --request {id}`, then click Allow.", { app: tg.name, id: tg.id }) } };
    case "not-running": return { id: tg.id, title, status: "unknown", detail: t("{app} is not running, so macOS cannot say; open it and run the check again", { app: tg.name }) };
    default: return { id: tg.id, title, status: "unknown", detail: t("could not ask macOS") };
  }
}

async function keychainClaude(p: Probes, ctx: DoctorCtx): Promise<DoctorItem> {
  const title = t("Keychain: Claude Code sign-in");
  if (p.platform !== "darwin") return { id: "keychain-claude", title, status: "n/a", detail: t("macOS only") };
  // no -w: only asks whether the item exists, so this never reads the secret and never prompts
  const r = await p.run(["security", "find-generic-password", "-s", "Claude Code-credentials"]);
  if (r.code !== 0) return { id: "keychain-claude", title, status: "missing", detail: t("no Claude Code sign-in found (the quota tile stays empty)"), fix: { text: t("Sign in to Claude Code on this Mac.") } };
  if (!ctx.claude) return { id: "keychain-claude", title, status: "unknown", detail: t("the item exists; not read yet") };
  if (ctx.claude.pending) return { id: "keychain-claude", title, status: "unknown", detail: t("checking…") };
  if (ctx.claude.ok) return { id: "keychain-claude", title, status: "ok", detail: t("the item exists and the last read worked") };
  return { id: "keychain-claude", title, status: "denied", detail: t("the item exists but the last read failed: {why}", { why: ctx.claude.error ?? "?" }), fix: { text: t("If macOS asked to access the Keychain, choose Always Allow. Otherwise sign in to Claude Code again.") } };
}

function keychainHass(p: Probes, ctx: DoctorCtx): DoctorItem {
  const title = t("Keychain: Home Assistant token");
  const h = ctx.hass;
  if (!h || !h.url) return { id: "keychain-hass", title, status: "n/a", detail: t("Home Assistant is not set up") };
  if (h.hasToken) return { id: "keychain-hass", title, status: "ok", detail: t("the token is readable") };
  return { id: "keychain-hass", title, status: "missing", detail: t("a URL is set but the token cannot be read"), fix: { text: t("Enter the token again on the management page (Integrations > Home Assistant).") } };
}

const UNREACHABLE = /EHOSTUNREACH|EHOSTDOWN|No route to host|Host is down/i;
function localNetwork(p: Probes, ctx: DoctorCtx): DoctorItem {
  const title = t("Local Network");
  const h = ctx.hass;
  if (p.platform !== "darwin") return { id: "local-network", title, status: "n/a", detail: t("macOS only") };
  if (!h || !h.url) return { id: "local-network", title, status: "n/a", detail: t("no device on your network is used (Home Assistant is not set up)") };
  if (h.connected) return { id: "local-network", title, status: "ok", detail: t("the last Home Assistant connection worked") };
  const why = `${h.detail ?? ""} ${h.error ?? ""}`;
  if (UNREACHABLE.test(why)) return {
    id: "local-network", title, status: "denied", detail: t("Home Assistant is unreachable ({why}): macOS may be blocking Local Network access", { why: (h.detail || h.error || "").slice(0, 80) }),
    fix: { text: t("Open System Settings > Privacy & Security > Local Network and turn {who} on.", { who: p.asService ? "phonedesk" : t("your terminal app") }), settingsUrl: PANES.localNetwork },
  };
  return { id: "local-network", title, status: "unknown", detail: t("the last Home Assistant connection failed: {why}", { why: (h.error ?? "?").slice(0, 100) }) };
}

async function firewall(p: Probes): Promise<DoctorItem> {
  const title = t("Firewall");
  if (p.platform !== "darwin") return { id: "firewall", title, status: "n/a", detail: t("macOS only") };
  const fw = "/usr/libexec/ApplicationFirewall/socketfilterfw";
  const g = await p.run([fw, "--getglobalstate"]);
  if (g.code !== 0) return { id: "firewall", title, status: "unknown", detail: t("could not read the firewall state") };
  if (!/enabled|State = [12]/i.test(g.out) || /disabled|State = 0/i.test(g.out)) return { id: "firewall", title, status: "ok", detail: t("the macOS firewall is off: phones can connect") };
  const a = await p.run([fw, "--getappblocked", p.exe]);
  if (/permitted|allowed/i.test(a.out) && !/not part|blocked/i.test(a.out)) return { id: "firewall", title, status: "ok", detail: t("the firewall is on and allows incoming connections to phonedesk") };
  if (/block/i.test(a.out) && !/not part/i.test(a.out)) return {
    id: "firewall", title, status: "denied", detail: t("the firewall is on and blocks incoming connections to phonedesk: phones cannot connect"),
    fix: { text: t("Open System Settings > Network > Firewall > Options and allow incoming connections for phonedesk."), settingsUrl: PANES.firewall },
  };
  return { id: "firewall", title, status: "unknown", detail: t("the firewall is on and phonedesk is not in its list: macOS asks to allow incoming connections the first time a phone connects"), fix: { text: t("Click Allow when macOS asks, or add phonedesk under Firewall > Options."), settingsUrl: PANES.firewall } };
}

async function signature(p: Probes): Promise<DoctorItem> {
  const title = t("Code signature");
  if (p.platform !== "darwin") return { id: "signature", title, status: "n/a", detail: t("macOS only") };
  const r = await p.run(["codesign", "-dv", "--verbose=2", p.exe]);
  if (/Signature=adhoc|flags=0x[0-9a-f]*\(adhoc/i.test(r.out)) return {
    id: "signature", title, status: "ok", detail: t("ad-hoc signed: macOS asks for permissions again after every update"),
    fix: { text: t("After an update, remove the old phonedesk entries in the Privacy lists and add it again (this goes away with Developer ID signing).") },
  };
  const auth = /Authority=(Developer ID Application:[^\n]+)/.exec(r.out)?.[1];
  if (auth) return { id: "signature", title, status: "ok", detail: t("signed by {who}", { who: auth }) };
  if (r.code !== 0) return { id: "signature", title, status: "unknown", detail: t("not signed or unreadable ({exe})", { exe: p.exe }) };
  return { id: "signature", title, status: "ok", detail: t("signed") };
}

async function hooks(p: Probes, ctx: DoctorCtx): Promise<DoctorItem[]> {
  const out: DoctorItem[] = [];
  const files = p.hookFiles();
  for (const tool of ["claude", "codex"] as const) {
    const id = `hooks-${tool}`;
    const title = t("{tool} hooks", { tool: tool === "claude" ? "Claude Code" : "Codex" });
    const file = files[tool];
    if (!file) { out.push({ id, title, status: "n/a", detail: t("not checked (sandboxed PHONEDESK_HOME)") }); continue; }
    let data: any;
    try { data = JSON.parse(await readFile(file, "utf8")); } catch { out.push({ id, title, status: "n/a", detail: t("not installed") }); continue; }
    const mine: string[] = [];
    for (const [event, marker] of [[HOOK_EVENT, HOOK_MARKER], [ASK_EVENT, ASK_MARKER]] as const)
      for (const g of Array.isArray(data?.hooks?.[event]) ? data.hooks[event] : [])
        for (const h of Array.isArray(g?.hooks) ? g.hooks : [])
          if (typeof h?.command === "string" && h.command.includes(marker) && sameInstance(commandInstance(h.command), ctx.instance)) mine.push(h.command);
    if (!mine.length) { out.push({ id, title, status: "n/a", detail: t("not installed") }); continue; }
    const stale = mine.filter((c) => repointCommand(c, p.program) !== null);
    out.push(stale.length
      ? { id, title, status: "missing", detail: t("installed, but {n} hook(s) point at another program", { n: stale.length }), fix: { text: t("Run `phonedesk hooks repoint` (an update does this for you).") } }
      : { id, title, status: "ok", detail: t("installed and pointing at this program") });
  }
  return out;
}

async function runWindows(p: Probes, ctx: DoctorCtx): Promise<DoctorReport> {
  const W = await import("./platform/win32/doctor");
  const items: DoctorItem[] = [{ id: "agent", title: t("PhoneDesk"), status: "ok", detail: `${p.version} · ${p.exe}` }];
  items.push(await W.startup(p), await W.signature(p), await W.smartscreen(p), W.desktopSession(p), await W.helper(p), await W.claudeSignIn(p, ctx), W.haToken(ctx), await W.network(p), await W.firewall(p));
  items.push(...(await hooks(p, ctx)));
  return { version: p.version, exe: p.exe, asService: p.asService, platform: p.platform, items };
}

export async function runDoctor(p: Probes, ctx: DoctorCtx): Promise<DoctorReport> {
  if (p.platform === "win32") return runWindows(p, ctx);
  const items: DoctorItem[] = [];
  items.push({ id: "agent", title: t("PhoneDesk"), status: "ok", detail: `${p.version} · ${p.exe}` });
  items.push({
    id: "service", title: t("Background service"),
    status: p.asService ? "ok" : "n/a",
    detail: p.asService ? t("running as the launchd service (permissions belong to phonedesk)") : t("started from a terminal (permissions belong to {who})", { who: t("the terminal app you started PhoneDesk from") }),
    ...(p.asService ? {} : { fix: { text: t("Run `phonedesk service install` to run in the background; macOS then asks for permissions for phonedesk itself.") } }),
  });
  items.push(await signature(p));
  items.push(accessibility(p));
  // System Events starts on demand, so launch it silently before asking; Music and Spotify are only reported when running
  if (p.platform === "darwin" && p.automation("com.apple.systemevents") === "not-running") {
    await p.run(["open", "-gj", "-b", "com.apple.systemevents"]);
    await new Promise((r) => setTimeout(r, 800));
  }
  for (const tg of AUTOMATION_TARGETS) items.push(automation(p, tg));
  items.push(await keychainClaude(p, ctx));
  items.push(keychainHass(p, ctx));
  items.push(localNetwork(p, ctx));
  items.push(await firewall(p));
  const np = p.which("nowplaying-cli");
  items.push(np
    ? { id: "nowplaying-cli", title: "nowplaying-cli", status: "ok", detail: np }
    : { id: "nowplaying-cli", title: "nowplaying-cli", status: "n/a", detail: t("not installed (optional: Now Playing for apps other than Music and Spotify)"), ...(p.platform === "darwin" ? { fix: { text: t("Install it with `brew install nowplaying-cli`.") } } : {}) });
  items.push(...(await hooks(p, ctx)));
  return { version: p.version, exe: p.exe, asService: p.asService, platform: p.platform, items };
}

/** Which ids `request()` can ask macOS for. */
export const REQUESTABLE = ["accessibility", ...AUTOMATION_TARGETS.map((x) => x.id)] as const;

/**
 * Asks macOS to show its permission prompt for `id`, so it lists the binary. Only runs when the user asked
 * (`phonedesk doctor --request <id>` / POST /api/doctor/request). Returns the state right after the call.
 */
export function describeRequest(id: string): { id: string; kind: "accessibility" | "automation"; bundle?: string } | null {
  if (id === "accessibility") return { id, kind: "accessibility" };
  const tg = AUTOMATION_TARGETS.find((x) => x.id === id);
  return tg ? { id, kind: "automation", bundle: tg.bundle } : null;
}

export const STATUS_MARK: Record<DoctorStatus, string> = { ok: "✓", missing: "✗", denied: "✗", unknown: "?", "n/a": "-" };

/** Plain text for the terminal: ✓ / ✗ / ? / -, with the fix under each problem. */
export function formatReport(r: DoctorReport, opts: { color?: boolean } = {}): string {
  const c = (code: string, s: string) => (opts.color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mark = (s: DoctorStatus) => (s === "ok" ? c("32", "✓") : s === "missing" || s === "denied" ? c("31", "✗") : s === "unknown" ? c("33", "?") : c("90", "-"));
  const lines = [`PhoneDesk doctor · ${r.version}`, ""];
  for (const it of r.items) {
    lines.push(`${mark(it.status)} ${it.title} - ${it.detail}`);
    if (it.status !== "ok" && it.status !== "n/a" && it.fix) {
      lines.push(`    ${t("Fix")}: ${it.fix.text}`);
      if (it.fix.settingsUrl) lines.push(`    ${t("Open the pane")}: phonedesk doctor --open ${it.id}`);
    } else if (it.fix && (it.status === "n/a" || it.id === "signature")) lines.push(`    ${t("Note")}: ${it.fix.text}`);
  }
  const bad = r.items.filter((i) => i.status === "missing" || i.status === "denied").length;
  lines.push("", bad ? t("{n} thing(s) need attention.", { n: bad }) : t("Everything that can be checked looks fine."));
  return lines.join("\n");
}

// ---------- the real probes (macOS) ----------

const APP_PATHS: Record<string, string[]> = {
  "com.apple.Music": ["/System/Applications/Music.app", "/Applications/Music.app"],
  "com.spotify.client": ["/Applications/Spotify.app", join(homedir(), "Applications", "Spotify.app")],
};

let ax: any;
function frameworks(): any {
  if (ax !== undefined) return ax;
  try {
    // bun:ffi only on macOS, only when asked
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const T = FFIType;
    const lib = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", {
      AXIsProcessTrusted: { args: [], returns: T.bool },
      AXIsProcessTrustedWithOptions: { args: [T.ptr], returns: T.bool },
      AEDeterminePermissionToAutomateTarget: { args: [T.ptr, T.u32, T.u32, T.bool], returns: T.i32 },
      AECreateDesc: { args: [T.u32, T.ptr, T.i64, T.ptr], returns: T.i16 },
      AEDisposeDesc: { args: [T.ptr], returns: T.i16 },
    });
    const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
      CFDataCreate: { args: [T.ptr, T.ptr, T.i64], returns: T.ptr },
      CFPropertyListCreateWithData: { args: [T.ptr, T.ptr, T.u64, T.ptr, T.ptr], returns: T.ptr },
      CFRelease: { args: [T.ptr], returns: T.void },
    });
    ax = { lib: lib.symbols, cf: cf.symbols, ptr: (require("bun:ffi") as typeof import("bun:ffi")).ptr };
  } catch {
    ax = null;
  }
  return ax;
}

const AUTOMATION_RESULT: Record<number, AutomationState> = { 0: "granted", [-1743]: "denied", [-1744]: "not-asked", [-600]: "not-running" };

/** AEDeterminePermissionToAutomateTarget for a bundle id; askUserIfNeeded=true shows macOS's prompt (only for `--request`). */
export function realAutomation(bundleId: string, ask = false): AutomationState {
  const f = frameworks();
  if (!f) return "unknown";
  try {
    const desc = new Uint8Array(16);
    const id = Buffer.from(bundleId);
    if (f.lib.AECreateDesc(0x62756e64 /* 'bund' */, f.ptr(id), id.length, f.ptr(desc)) !== 0) return "unknown";
    const r = f.lib.AEDeterminePermissionToAutomateTarget(f.ptr(desc), 0x2a2a2a2a, 0x2a2a2a2a, ask) as number;
    f.lib.AEDisposeDesc(f.ptr(desc));
    return AUTOMATION_RESULT[r] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** AXIsProcessTrustedWithOptions(prompt=true): shows macOS's Accessibility prompt and lists this program. Returns whether it is trusted now. */
export function realAxPrompt(): boolean | null {
  const f = frameworks();
  if (!f) return null;
  try {
    const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>AXTrustedCheckOptionPrompt</key><true/></dict></plist>');
    const data = f.cf.CFDataCreate(null, f.ptr(xml), xml.length);
    const dict = f.cf.CFPropertyListCreateWithData(null, data, 0, null, null);
    const r = f.lib.AXIsProcessTrustedWithOptions(dict) as boolean;
    if (dict) f.cf.CFRelease(dict);
    if (data) f.cf.CFRelease(data);
    return r;
  } catch {
    return null;
  }
}

async function winHelperPing(): Promise<string> {
  const { WinHelper } = await import("./platform/win32/helper");
  const h = new WinHelper();
  try { return await h.call<string>("ping", {}, 15_000); } finally { h.dispose(); }
}

export function realProbes(version: string): Probes {
  const platform = osPlatform.id;
  return {
    platform,
    exe: process.execPath,
    program: defaultProgram(),
    version,
    asService: process.env.XPC_SERVICE_NAME === SERVICE_LABEL || process.env.PHONEDESK_SERVICE === "1",
    run: async (argv) => {
      try {
        const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => p.kill(), 5000);
        const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        clearTimeout(timer);
        return { code: await p.exited, out: `${o}\n${e}`.trim() };
      } catch (err: any) {
        return { code: 127, out: String(err?.message ?? err) };
      }
    },
    axTrusted: () => {
      if (platform !== "darwin") return null;
      const f = frameworks();
      try { return f ? (f.lib.AXIsProcessTrusted() as boolean) : null; } catch { return null; }
    },
    automation: (b) => (platform === "darwin" ? realAutomation(b, false) : "unknown"),
    installed: (b) => (APP_PATHS[b] ?? []).some((x) => existsSync(x)),
    which: (n) => Bun.which(n),
    requestAccessibility: () => (platform === "darwin" ? realAxPrompt() : null),
    requestAutomation: (b) => (platform === "darwin" ? realAutomation(b, true) : "unknown"),
    // read-only here, but keep the same sandbox rule as the hook commands
    hookFiles: () => hookTargets().files,
    desktop: () => (platform === "win32" ? { station: winStation(), idle: winIdle() } : { station: null, idle: null }),
    helperPing: async () => { try { return (await winHelperPing()) === "pong"; } catch { return false; } },
    fileExists: (f) => existsSync(f),
    claudeCredentialsFile: () => join(process.env.PHONEDESK_CLAUDE_DIR ?? join(homedir(), ".claude"), ".credentials.json"),
  };
}
