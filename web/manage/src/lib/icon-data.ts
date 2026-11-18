import { useEffect, useState } from "react";
import { api } from "@/api";
import { t } from "@/lib/i18n";
import type { IconCatalog } from "@/types";

let catalog: IconCatalog | null = null;
let pending: Promise<IconCatalog | null> | null = null;
let failed: string | null = null;
const listeners = new Set<() => void>();

/** Loads GET /api/icons/catalog once (6 MB uncompressed, gzip on the wire) and shares it. */
export function loadCatalog(): Promise<IconCatalog | null> {
  if (catalog) return Promise.resolve(catalog);
  pending ??= api
    .getCatalog()
    .then((c) => {
      catalog = c && typeof c === "object" && c.icons ? c : null;
      if (!catalog) failed = t("Catalog is empty");
      return catalog;
    })
    .catch((e: unknown) => {
      failed = e instanceof Error ? e.message : String(e);
      pending = null; // allow a retry on the next request
      return null;
    })
    .finally(() => listeners.forEach((l) => l()));
  return pending;
}

export const catalogNow = () => catalog;

/** The catalog, loaded lazily the first time a component asks for it. */
export function useCatalog(enabled = true): { catalog: IconCatalog | null; loading: boolean; error: string | null; retry: () => void } {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (enabled && !catalog) void loadCatalog();
    return () => void listeners.delete(l);
  }, [enabled]);
  return {
    catalog,
    loading: enabled && !catalog && !failed,
    error: catalog ? null : failed,
    retry: () => {
      failed = null;
      void loadCatalog().then(() => undefined);
      tick((n) => n + 1);
    },
  };
}
