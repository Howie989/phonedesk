import { basename, join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { claudeDir } from "./claude";
import { codexDir, headText, tailText } from "./codex";
import type { AiSession, SessionState, WaitingHint } from "./types";

export const WORKING_MS = 20_000;
export const RECENT_MS = 24 * 3600_000;
export const MAX_SESSIONS = 12;
/** A finished turn only counts as "needs you" while the transcript was touched in the last 10 minutes. */
export const INPUT_WINDOW_MS = 10 * 60_000;

export function sessionState(mtime: number, now: number, waiting: boolean): SessionState {
  if (waiting) return "waiting";
  return now - mtime < WORKING_MS ? "working" : "idle";
}

/** Last path segment of a cwd, tolerant of both separators. */
export function projectName(cwd: string): string {
  return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd;
}

/** Best effort decode of Claude's project folder name ("-Users-me-code-app" -> "app"). */
export function decodeProjectDir(dir: string): string {
  return dir.replace(/^-+/, "").split("-").filter(Boolean).pop() ?? dir;
}

const parseLines = (text: string): any[] => {
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { out.push(JSON.parse(line)); } catch { /* cut line */ }
  }
  return out;
};

/**
 * Has this Claude Code session finished its turn and is waiting for the user to type? True when the last conversation
 * entry is an assistant message that ended its turn (no pending tool call) and nothing newer from the user, and the
 * transcript was modified within the last 10 minutes. Never reads or returns prompt or response text.
 */
export function claudeNeedsInput(tail: string, mtime: number, now: number): boolean {
  if (now - mtime >= INPUT_WINDOW_MS) return false;
  const lines = parseLines(tail);
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (o.type !== "assistant" && o.type !== "user") continue; // summaries, titles, snapshots, system notes
    if (o.isSidechain === true) continue; // sub-agent traffic
    if (o.type === "user") return false; // a newer user entry (or a tool result): the assistant is up
    const content = o.message?.content;
    if (Array.isArray(content) && content.some((c: any) => c?.type === "tool_use")) return false; // a tool call is pending
    const stop = o.message?.stop_reason;
    if (typeof stop === "string") return stop !== "tool_use";
    return now - mtime >= WORKING_MS; // no stop reason recorded: treat quiet for 20 s as finished
  }
  return false;
}

/** Same for a Codex rollout: the last response item is an assistant message (or the turn reported complete). */
export function codexNeedsInput(tail: string, mtime: number, now: number): boolean {
  if (now - mtime >= INPUT_WINDOW_MS) return false;
  const lines = parseLines(tail);
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    const p = o?.payload;
    if (o?.type === "event_msg") {
      if (p?.type === "task_complete") return true;
      if (p?.type === "task_started" || p?.type === "user_message") return false;
      continue;
    }
    if (o?.type !== "response_item") continue;
    if (p?.type === "reasoning") continue;
    return p?.type === "message" && p?.role === "assistant";
  }
  return false;
}

export interface TailInfo {
  cwd?: string;
  model?: string;
  title?: string;
  tokens?: number;
}

/**
 * Pulls cwd, model and an explicit session title out of the last lines of a Claude Code transcript.
 * Never returns prompt or response text.
 */
export function summarizeClaudeTail(text: string): TailInfo {
  const info: TailInfo = {};
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && !(info.cwd && info.model && info.title); i--) {
    const line = lines[i]!;
    if (!line.startsWith("{")) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!info.cwd && typeof o.cwd === "string") info.cwd = o.cwd;
    if (!info.model && o.type === "assistant" && typeof o.message?.model === "string" && o.message.model !== "<synthetic>") info.model = o.message.model;
    if (!info.title && o.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle) info.title = o.customTitle.slice(0, 80);
  }
  return info;
}

/** cwd from the session_meta line at the head, model from the last turn_context in the tail. */
export function summarizeCodex(head: string, tail: string): TailInfo {
  const info: TailInfo = {};
  const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
  if (cwd) {
    try {
      info.cwd = JSON.parse(`"${cwd}"`);
    } catch {
      info.cwd = cwd;
    }
  }
  const models = [...tail.matchAll(/"model":"([^"]+)"/g)];
  const last = models[models.length - 1]?.[1];
  if (last) info.model = last;
  return info;
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

const isWaiting = (s: { tool: "claude" | "codex"; id: string; cwd?: string }, hints: WaitingHint[]) =>
  hints.some((h) => h.source === s.tool && (h.sessionId ? h.sessionId === s.id : !!h.cwd && h.cwd === s.cwd));

async function claudeSessions(dir: string, now: number, hints: WaitingHint[]): Promise<AiSession[]> {
  const root = join(dir, "projects");
  const cands: Array<{ file: string; folder: string; mtime: number }> = [];
  for (const folder of await readdir(root).catch(() => [] as string[])) {
    for (const name of await readdir(join(root, folder)).catch(() => [] as string[])) {
      if (!name.endsWith(".jsonl")) continue;
      try {
        const mtime = (await stat(join(root, folder, name))).mtimeMs;
        if (now - mtime < RECENT_MS) cands.push({ file: join(root, folder, name), folder, mtime });
      } catch {
        // vanished
      }
    }
  }
  cands.sort((a, b) => b.mtime - a.mtime);
  const out: AiSession[] = [];
  for (const c of cands.slice(0, MAX_SESSIONS)) {
    const tail = await tailText(c.file, 128 * 1024).catch(() => "");
    const info = summarizeClaudeTail(tail);
    const id = UUID.exec(c.file)?.[1] ?? basename(c.file, ".jsonl");
    const prompt = isWaiting({ tool: "claude", id, cwd: info.cwd }, hints);
    out.push({
      id,
      tool: "claude",
      project: info.cwd ? projectName(info.cwd) : decodeProjectDir(c.folder),
      ...(info.title ? { title: info.title } : {}),
      ...(info.model ? { model: info.model } : {}),
      state: sessionState(c.mtime, now, prompt || claudeNeedsInput(tail, c.mtime, now)),
      ...(prompt ? { prompt: true as const } : {}),
      updatedAt: Math.round(c.mtime),
    });
  }
  return out;
}

async function codexSessions(dir: string, now: number, hints: WaitingHint[]): Promise<AiSession[]> {
  const root = join(dir, "sessions");
  const cands: Array<{ file: string; mtime: number }> = [];
  const ls = (p: string) => readdir(p).catch(() => [] as string[]);
  // only the newest few day folders can hold files changed in the last 24 h
  let days = 0;
  outer: for (const y of (await ls(root)).sort().reverse()) {
    for (const m of (await ls(join(root, y))).sort().reverse()) {
      for (const d of (await ls(join(root, y, m))).sort().reverse()) {
        for (const n of await ls(join(root, y, m, d))) {
          if (!n.endsWith(".jsonl")) continue;
          try {
            const mtime = (await stat(join(root, y, m, d, n))).mtimeMs;
            if (now - mtime < RECENT_MS) cands.push({ file: join(root, y, m, d, n), mtime });
          } catch {
            // vanished
          }
        }
        if (++days >= 3) break outer;
      }
    }
  }
  cands.sort((a, b) => b.mtime - a.mtime);
  const out: AiSession[] = [];
  for (const c of cands.slice(0, MAX_SESSIONS)) {
    const [head, tail] = await Promise.all([headText(c.file).catch(() => ""), tailText(c.file, 128 * 1024).catch(() => "")]);
    const info = summarizeCodex(head, tail);
    const id = UUID.exec(c.file)?.[1] ?? basename(c.file, ".jsonl");
    const prompt = isWaiting({ tool: "codex", id, cwd: info.cwd }, hints);
    out.push({
      id,
      tool: "codex",
      project: info.cwd ? projectName(info.cwd) : "codex",
      ...(info.model ? { model: info.model } : {}),
      state: sessionState(c.mtime, now, prompt || codexNeedsInput(tail, c.mtime, now)),
      ...(prompt ? { prompt: true as const } : {}),
      updatedAt: Math.round(c.mtime),
    });
  }
  return out;
}

export interface SessionDirs {
  claude?: string;
  codex?: string;
}

/** Claude Code and Codex sessions touched in the last 24 h, newest first, at most 12. */
export async function listSessions(hints: WaitingHint[] = [], now = Date.now(), dirs: SessionDirs = {}): Promise<AiSession[]> {
  const [a, b] = await Promise.all([
    claudeSessions(dirs.claude ?? claudeDir(), now, hints).catch(() => []),
    codexSessions(dirs.codex ?? codexDir(), now, hints).catch(() => []),
  ]);
  return [...a, ...b].sort((x, y) => y.updatedAt - x.updatedAt).slice(0, MAX_SESSIONS);
}
