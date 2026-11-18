import type { AiSession, SessionTool } from "./types";

export type ToolState = "busy" | "idle" | "waiting";

/**
 * What the tools themselves report through their hooks/plugins (Grok hooks, the OpenCode 1.x plugin): per session,
 * busy / idle / waiting. In memory only; an entry older than 2 h is forgotten (a crashed tool never sends "idle").
 */
export class ToolStates {
  private m = new Map<string, { state: ToolState; at: number }>();
  constructor(private now: () => number = Date.now, private ttlMs = 2 * 3600_000) {}
  set(tool: SessionTool, sessionId: string, state: ToolState) { this.m.set(`${tool}:${sessionId}`, { state, at: this.now() }); }
  get(tool: SessionTool, sessionId: string): { state: ToolState; at: number } | undefined {
    const e = this.m.get(`${tool}:${sessionId}`);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.m.delete(`${tool}:${sessionId}`); return undefined; }
    return e;
  }
  /** Any session of this tool that reports being in `state` (for tools that give no session id in a notification). */
  clear() { this.m.clear(); }
}

/** Applies a tool-reported state to a session: waiting wins, then busy -> working, idle -> idle. */
export function withToolState(s: AiSession, st: { state: ToolState; at: number } | undefined): AiSession {
  if (!st) return s;
  if (st.state === "waiting") return { ...s, state: "waiting" };
  if (st.state === "busy") return { ...s, state: "working" };
  return { ...s, state: s.state === "waiting" ? "waiting" : "idle" };
}
