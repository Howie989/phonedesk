import { platform } from "../platform";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { t } from "../i18n";
import { safeHome, type AiSession, type ProviderQuota } from "./types";
import { projectName, sessionState, MAX_SESSIONS } from "./sessions";
import { SESSION_WINDOW_MS } from "./opencode";
import { withToolState, type ToolStates } from "./states";

/*
 * Grok Build (`grok`, xAI). Read-only from its own files:
 *  - ~/.grok/sessions/<url-encoded cwd>/<id>/summary.json and ~/.grok/active_sessions.json (GROK_HOME overrides the base);
 *  - busy / idle / waiting come from an opt-in hook file, ~/.grok/hooks/phonedesk.json, that PhoneDesk installs and removes.
 * There is no usage API, so there is no quota. A Grok hook can only deny, never approve, and cannot answer questions:
 * the phone only learns "Grok is waiting for you".
 */

export const grokDir = (): string => process.env.GROK_HOME || join(safeHome() || homedir(), ".grok");
export const grokHookFile = (): string => join(grokDir(), "hooks", "phonedesk.json");
/** The grok binary: PHONEDESK_GROK (authoritative, for tests), PATH, then ~/.grok/bin and the usual places (a service's PATH is short). */
export function grokPath(): string | null {
  const forced = process.env.PHONEDESK_GROK;
  if (forced) return existsSync(forced) ? forced : null;
  const onPath = Bun.which("grok", { PATH: process.env.PATH ?? "" });
  if (onPath) return onPath;
  const home = safeHome() || homedir();
  const exe = platform.id === "win32" ? [".exe", ".cmd"] : [""];
  for (const d of [join(grokDir(), "bin"), join(home, ".local", "bin"), join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]) for (const e of exe) { const f = join(d, `grok${e}`); if (existsSync(f)) return f; }
  return null;
}
export const grokDataFound = (): boolean => existsSync(join(grokDir(), "sessions")) || existsSync(grokDir());
export const GROK_NO_QUOTA = () => t("Grok has no usage API");

export function grokQuota(now = Date.now()): ProviderQuota {
  return { id: "grok", name: "Grok", windows: [], error: GROK_NO_QUOTA(), updatedAt: now };
}

const toMs = (v: unknown): number => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const p = Date.parse(String(v ?? ""));
  return Number.isFinite(p) ? p : 0;
};

/** Ids in active_sessions.json: an array of ids or objects, or an object keyed by id (or holding such a list). */
export function parseActiveSessions(j: any): string[] {
  const list = Array.isArray(j) ? j : Array.isArray(j?.sessions) ? j.sessions : j && typeof j === "object" ? Object.keys(j) : [];
  return list.map((x: any) => (typeof x === "string" ? x : x?.id ?? x?.session_id ?? x?.sessionId)).filter((x: unknown): x is string => typeof x === "string");
}

/**
 * Recent sessions: every folder under sessions/<url-encoded cwd>/<id>/ whose summary.json was updated in the last 7 days
 * (newest first, at most 12), shown idle unless the session is listed in active_sessions.json (running), was written to in the
 * last 20 s (working) or a hook told us otherwise (busy / idle / waiting). The real summary.json has info.{id,cwd},
 * session_summary / generated_title, current_model_id, updated_at, last_active_at.
 */
export async function readGrokSessions(opts: { dir?: string; now?: number; states?: ToolStates; limit?: number; windowMs?: number } = {}): Promise<AiSession[]> {
  const dir = opts.dir ?? grokDir(), now = opts.now ?? Date.now(), win = opts.windowMs ?? SESSION_WINDOW_MS;
  const root = join(dir, "sessions");
  const active = new Set(parseActiveSessions(await readFile(join(dir, "active_sessions.json"), "utf8").then(JSON.parse, () => null)));
  const cands: { id: string; folder: string; file: string; mtime: number }[] = [];
  for (const folder of await readdir(root).catch(() => [] as string[])) {
    for (const id of await readdir(join(root, folder)).catch(() => [] as string[])) {
      const file = join(root, folder, id, "summary.json");
      try { cands.push({ id, folder, file, mtime: (await stat(file)).mtimeMs }); } catch { /* a folder without a summary (prompt_history.jsonl ...) */ }
    }
  }
  cands.sort((a, b) => b.mtime - a.mtime);
  const out: AiSession[] = [];
  for (const c of cands.slice(0, 60)) {
    let j: any;
    try { j = JSON.parse(await readFile(c.file, "utf8")); } catch { continue; }
    const at = Math.max(toMs(j?.updated_at), toMs(j?.last_active_at)) || c.mtime;
    const id = typeof j?.info?.id === "string" ? j.info.id : c.id;
    const isActive = active.has(id) || active.has(c.id);
    if (now - at >= win && !isActive) continue;
    let cwd = typeof j?.info?.cwd === "string" ? j.info.cwd : c.folder;
    if (cwd === c.folder) { try { cwd = decodeURIComponent(c.folder); } catch { /* raw */ } }
    const title = [j?.generated_title, j?.session_summary, j?.title].find((x) => typeof x === "string" && x);
    const model = typeof j?.current_model_id === "string" ? j.current_model_id : undefined;
    const base: AiSession = {
      id, tool: "grok", project: projectName(cwd),
      ...(title ? { title: String(title).slice(0, 80) } : {}),
      ...(model ? { model } : {}),
      state: sessionState(at, now, false),
      updatedAt: Math.round(at),
      ...(isActive ? { running: true as const } : {}),
    };
    out.push(withToolState(base, opts.states?.get("grok", id)));
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, opts.limit ?? MAX_SESSIONS);
}

// ---------- the opt-in hook file ----------

export const GROK_STATES = [
  { event: "UserPromptSubmit", state: "busy" },
  { event: "Stop", state: "idle" },
  { event: "StopFailure", state: "idle" },
  { event: "StopCancelled", state: "idle" },
  { event: "Notification", state: "waiting", matcher: "idle_prompt|permission_prompt" },
] as const;
export const GROK_HOOK_TIMEOUT_S = 5;
export const GROK_MARKER = "phonedesk hook grok";

/** The command text for one state, built from the usual `<exe> hook claude ...` command (same --port/--home conventions). */
export const grokCommandFor = (base: string, state: string) => base.replace(/ hook claude/, ` hook grok ${state}`).replace(/# phonedesk hook$/, `# ${GROK_MARKER}`);

export function grokHookContent(base: string): string {
  const hooks: Record<string, unknown[]> = {};
  for (const e of GROK_STATES) {
    hooks[e.event] = [{ ...("matcher" in e ? { matcher: e.matcher } : {}), hooks: [{ type: "command", command: grokCommandFor(base, e.state), timeout: GROK_HOOK_TIMEOUT_S }] }];
  }
  return JSON.stringify({ hooks }, null, 2) + "\n";
}

export async function isGrokHookInstalled(file = grokHookFile()): Promise<boolean> {
  try { return (await readFile(file, "utf8")).includes(GROK_MARKER); } catch { return false; }
}

/** Writes ~/.grok/hooks/phonedesk.json (a file of our own). Refuses to overwrite a file that is not ours. */
export async function installGrokHook(baseCommand: string, file = grokHookFile()): Promise<{ changed: boolean }> {
  let cur: string | null = null;
  try { cur = await readFile(file, "utf8"); } catch { /* new */ }
  if (cur !== null && !cur.includes(GROK_MARKER)) throw new Error(`${file} exists and was not written by PhoneDesk; refusing to overwrite it`);
  const next = grokHookContent(baseCommand);
  if (cur === next) return { changed: false };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  await chmod(file, 0o644).catch(() => {});
  return { changed: true };
}

export async function uninstallGrokHook(file = grokHookFile()): Promise<{ changed: boolean }> {
  let cur: string;
  try { cur = await readFile(file, "utf8"); } catch { return { changed: false }; }
  if (!cur.includes(GROK_MARKER)) return { changed: false };
  await rm(file, { force: true });
  return { changed: true };
}

/** `phonedesk hook grok <state>` stdin -> the fields the agent needs (Grok sends camelCase; snake_case tolerated). */
export function grokStateFromStdin(stdin: string): { sessionId?: string; cwd?: string } {
  try {
    const o = JSON.parse(stdin);
    const sessionId = o?.sessionId ?? o?.session_id;
    return { ...(typeof sessionId === "string" ? { sessionId } : {}), ...(typeof o?.cwd === "string" ? { cwd: o.cwd } : {}) };
  } catch { return {}; }
}
