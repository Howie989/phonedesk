import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HOME } from "./../config";
import { platform } from "../platform";
import type { SecretStore } from "../platform/types";
import { keychainStore } from "../platform/darwin";

export const KEYCHAIN_SERVICE = "PhoneDesk-HASS";
export const KEYCHAIN_ACCOUNT = "token";

interface FileShape { url?: string; token?: string }

export type Runner = (argv: string[]) => Promise<string>;

/** Normalizes what the user typed into a base URL (no trailing slash, http or https only). Throws a readable error. */
export function normalizeHassUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("url is required");
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`); } catch { throw new Error("url is not valid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("url must start with http:// or https://");
  if (u.username || u.password) throw new Error("do not put credentials in the url");
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

/** The websocket endpoint for a base URL. */
export const hassWsUrl = (base: string) => `${base.replace(/^http/i, "ws")}/api/websocket`;

/**
 * URL in ~/.phonedesk/hass.json. The token goes to the macOS Keychain (service PhoneDesk-HASS); when that is not
 * available it falls back to the same file (0600). The token is never returned by any API.
 */
export class HassConfigStore {
  private file: string;
  private secrets: SecretStore | null;
  /** `run` / `platform` are for tests: a fake `security` on "darwin", or no secret store on another id. */
  constructor(o: { home?: string; run?: Runner; platform?: string } = {}) {
    this.file = join(o.home ?? HOME, "hass.json");
    if (o.run || o.platform) {
      this.secrets = (o.platform ?? "darwin") === "darwin" ? keychainStore(o.run ? (argv) => o.run!(argv) : undefined) : null;
    } else {
      this.secrets = null; // resolved lazily: the real platform store
    }
    this.useReal = !o.run && !o.platform;
  }
  private useReal: boolean;
  private store(): SecretStore | null { return this.useReal ? platform.secrets : this.secrets; }

  private async read(): Promise<FileShape> {
    try { return JSON.parse(await readFile(this.file, "utf8")) ?? {}; } catch { return {}; }
  }
  private async write(d: FileShape) {
    await mkdir(join(this.file, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
  }

  async url(): Promise<string | undefined> { return (await this.read()).url; }

  async setUrl(raw: unknown): Promise<string> {
    const url = normalizeHassUrl(raw);
    const d = await this.read();
    await this.write({ ...d, url });
    return url;
  }

  /** The token, or undefined. Looks in the Keychain only when a url is configured, so a fresh install never touches it. */
  async token(): Promise<string | undefined> {
    const d = await this.read();
    if (d.token) return d.token;
    const store = this.store();
    if (!d.url || !store) return undefined;
    return store.get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  }

  async hasToken(): Promise<boolean> { return !!(await this.token()); }

  async setToken(token: unknown): Promise<"keychain" | "file"> {
    if (typeof token !== "string" || !token.trim() || token.length > 2048 || /\s/.test(token.trim())) throw new Error("token is not valid");
    const t = token.trim();
    const d = await this.read();
    const store = this.store();
    if (store && (await store.set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, t))) {
      if (d.token) { delete d.token; await this.write(d); }
      return "keychain";
    }
    await this.write({ ...d, token: t });
    return "file";
  }

  async clearToken(): Promise<void> {
    const d = await this.read();
    if (d.token) { delete d.token; await this.write(d); }
    await this.store()?.remove(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  }
}
