import { t } from "../i18n";
export type AiProviderId = "claude" | "codex" | "antigravity";
export type QuotaSource = "claude-code" | "codex-sessions" | "antigravity-local";
export const QUOTA_SOURCE: Record<AiProviderId, QuotaSource> = { claude: "claude-code", codex: "codex-sessions", antigravity: "antigravity-local" };

export interface QuotaWindow {
  id: string;
  label: string; // translated, e.g. "5 hours", "7 days"
  usedPercent: number; // 0-100
  resetsAt?: number; // ms since epoch
  windowMinutes?: number;
  /** usedPercent samples [ms, percent], one per 5 minutes for up to 24 h, at most 48 points. */
  history?: [number, number][];
}

export interface QuotaExtra {
  label: string;
  value: number;
  unit: string;
}

export interface ProviderQuota {
  id: AiProviderId;
  name: string;
  plan?: string;
  windows: QuotaWindow[];
  error?: string;
  updatedAt: number;
  /** Where the windows come from. Read-only: Claude Code's own token, Codex's local session files, the local Antigravity tools. */
  source?: QuotaSource;
  /** Balances (credits, resets...). */
  extras?: QuotaExtra[];
}

export type SessionState = "working" | "waiting" | "idle";

export interface AiSession {
  id: string;
  tool: "claude" | "codex";
  project: string;
  title?: string;
  model?: string;
  /**
   * "waiting" = it needs YOU: the turn is finished and it waits for you to type (or a permission request / question is pending,
   * see `prompt`). "working" = written to in the last 20 s. Otherwise "idle".
   */
  state: SessionState;
  /** A permission request or question of this session is pending right now (already shown as a sheet on the phone). */
  prompt?: true;
  updatedAt: number;
  tokens?: number;
}

export interface AiSnapshot {
  providers: ProviderQuota[];
  sessions: AiSession[];
}

/** What a pending permission request tells the session scanner, to mark sessions "waiting". */
export interface WaitingHint {
  source: "claude" | "codex";
  sessionId?: string;
  cwd?: string;
}

export const clampPercent = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

/** "5 hours", "7 days", "30 days", "45 min" from a window length. */
export function windowLabel(minutes: number): string {
  if (minutes < 60) return t("{n} min", { n: minutes });
  const hours = minutes / 60;
  if (hours < 48) return t("{n} hours", { n: Math.round(hours) });
  return t("{n} days", { n: Math.round(hours / 24) });
}

export function safeHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}
