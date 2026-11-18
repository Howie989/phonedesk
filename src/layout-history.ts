import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HOME, validateLayout, type Layout } from "./config";

export const HISTORY_MAX = 50;
export const layoutHistoryDir = () => join(HOME, "layout-history");

export interface HistoryEntry {
  id: string;
  /** When it was saved (ms). */
  at: number;
  pages: number;
  items: number;
}

const FILE_RE = /^(\d{13})-(\d{4})\.json$/;

/**
 * The last 50 saved layouts as timestamped JSON files (0600), newest last in the stack. Used by `undo` and the
 * management page. The newest entry is the layout currently in force.
 */
export class LayoutHistory {
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(private dir = layoutHistoryDir(), private now: () => number = Date.now) {}

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => FILE_RE.test(f)).sort();
    } catch {
      return [];
    }
  }

  private async read(file: string): Promise<Layout | null> {
    try {
      return validateLayout(JSON.parse(await readFile(join(this.dir, file), "utf8")));
    } catch {
      return null;
    }
  }

  /** Records a layout. Identical to the newest entry: skipped. Returns true when written. */
  push(layout: Layout): Promise<boolean> {
    return this.lock(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const files = await this.files();
      const body = JSON.stringify(layout, null, 2) + "\n";
      const last = files[files.length - 1];
      if (last && (await readFile(join(this.dir, last), "utf8").catch(() => "")) === body) return false;
      const name = `${String(this.now()).padStart(13, "0")}-${String(this.seq++ % 10000).padStart(4, "0")}.json`;
      const file = join(this.dir, name);
      await writeFile(file, body, { mode: 0o600 });
      await chmod(file, 0o600);
      const all = [...files, name];
      for (const old of all.slice(0, Math.max(0, all.length - HISTORY_MAX))) await rm(join(this.dir, old), { force: true });
      return true;
    });
  }

  /** Newest first. */
  list(): Promise<HistoryEntry[]> {
    return this.lock(async () => {
      const out: HistoryEntry[] = [];
      for (const f of (await this.files()).reverse()) {
        const l = await this.read(f);
        if (!l) continue;
        out.push({ id: f.replace(/\.json$/, ""), at: Number(f.slice(0, 13)), pages: l.pages.length, items: l.pages.reduce((n, p) => n + p.items.length, 0) });
      }
      return out;
    });
  }

  /**
   * Drops the newest entry and returns the one before it (now the current layout). Null when there is nothing older.
   * Unreadable older entries are skipped and removed.
   */
  undo(): Promise<Layout | null> {
    return this.lock(async () => {
      const files = await this.files();
      if (files.length < 2) return null;
      await rm(join(this.dir, files[files.length - 1]!), { force: true });
      for (let i = files.length - 2; i >= 0; i--) {
        const l = await this.read(files[i]!);
        if (l) return l;
        await rm(join(this.dir, files[i]!), { force: true });
      }
      return null;
    });
  }
}
