import { DECK, MANAGE, type AssetFile } from "./assets.gen";

export interface Resolved {
  file: AssetFile;
  cache: string;
  localOnly: boolean;
}

const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";

const cacheFor = (rel: string, file: AssetFile) =>
  rel.startsWith("assets/") ? IMMUTABLE : file.type.startsWith("text/html") ? NO_CACHE : NO_CACHE;

/** Maps a URL path to an embedded asset. Deck is served at /, manage at /manage/ (localhost only). */
export function resolveAsset(
  path: string,
  deck: Record<string, AssetFile> = DECK,
  manage: Record<string, AssetFile> = MANAGE,
): Resolved | null {
  if (path === "/manage" || path.startsWith("/manage/")) {
    const rel = path.slice("/manage/".length);
    const hit = rel ? manage[rel] : undefined;
    if (hit) return { file: hit, cache: cacheFor(rel, hit), localOnly: true };
    // SPA fallback only for extensionless routes
    const last = path.split("/").pop() ?? "";
    if (!rel || !last.includes(".")) {
      const index = manage["index.html"];
      return index ? { file: index, cache: NO_CACHE, localOnly: true } : null;
    }
    return null;
  }
  const rel = path === "/" ? "index.html" : path.slice(1);
  const hit = deck[rel];
  return hit ? { file: hit, cache: cacheFor(rel, hit), localOnly: false } : null;
}
