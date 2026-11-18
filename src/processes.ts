import { basename } from "node:path";
import { platform } from "./platform";

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number; // percent
  mem: number; // resident bytes
}

export type ProcessSort = "cpu" | "mem";
export const MAX_PROCESSES = 50;

/** Pure: parses `ps -Ao pid,pcpu,rss,comm` (rss in KB, comm may contain spaces). */
export function parsePs(output: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), cpu: Number(m[2]!.replace(",", ".")), mem: Number(m[3]) * 1024, name: basename(m[4]!) || m[4]! });
  }
  return out;
}

export function topProcessesFrom(all: ProcessInfo[], sort: ProcessSort, limit: number): ProcessInfo[] {
  const n = Math.min(MAX_PROCESSES, Math.max(1, Math.floor(limit)));
  return [...all].sort((a, b) => (sort === "cpu" ? b.cpu - a.cpu || b.mem - a.mem : b.mem - a.mem || b.cpu - a.cpu)).slice(0, n);
}

/** Validates a client {type:"processes"} request. */
export function parseProcessesRequest(msg: any): { sort: ProcessSort; limit: number } | { error: string } {
  const sort = msg?.sort;
  if (sort !== "cpu" && sort !== "mem") return { error: 'sort must be "cpu" or "mem"' };
  const limit = msg.limit === undefined ? 10 : msg.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_PROCESSES) {
    return { error: `limit must be an integer 1-${MAX_PROCESSES}` };
  }
  return { sort, limit };
}

/** Top processes. With an injected runner it reads `ps` (tests, Unix); otherwise the platform does (Windows: its helper). */
export async function topProcesses(sort: ProcessSort, limit: number, run?: (argv: string[]) => Promise<string>): Promise<ProcessInfo[]> {
  if (run) return topProcessesFrom(parsePs(await run(["ps", "-Ao", "pid,pcpu,rss,comm"])), sort, limit);
  return platform.topProcesses(sort, limit);
}
