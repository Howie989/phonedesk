import { platform } from "./platform";
import { hostname, networkInterfaces } from "node:os";

/** First non-internal IPv4 address, preferring private LAN ranges. Falls back to localhost. */
export function lanIp(): string {
  const candidates: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) candidates.push(a.address);
    }
  }
  const priv = candidates.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return priv ?? candidates[0] ?? "localhost";
}

export function isLocal(ip: string | undefined | null): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

let cachedHost: string | undefined;

/**
 * The name other devices on the LAN can reach this machine by (`<name>.local`, mDNS/Bonjour): the macOS LocalHostName
 * (`scutil --get LocalHostName`), else the first label of os.hostname(). Stays the same when the IP changes.
 */
export async function localHostName(run?: (argv: string[]) => Promise<string>): Promise<string> {
  if (cachedHost && !run) return cachedHost;
  let name = "";
  try {
    // an injected runner stands in for the macOS `scutil` call (tests); otherwise the platform knows its LAN name
    name = (run ? (platform.id === "darwin" ? await run(["scutil", "--get", "LocalHostName"]) : "") : (await platform.lanName()) ?? "").trim();
  } catch {
    /* fall through */
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) name = hostname().split(".")[0]!.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "localhost";
  if (!run) cachedHost = name;
  return name;
}
