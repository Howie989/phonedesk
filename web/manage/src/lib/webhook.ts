import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/api";
import type { WebhookInfo } from "@/types";

/** Masked webhook key and the agent's curl examples. `missing` = old agent (404). */
export function useWebhook(): { info: WebhookInfo | null; missing: boolean; error: string | null; reload: () => Promise<void> } {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setInfo(await api.getWebhook());
      setMissing(false);
      setError(null);
    } catch (e) {
      setMissing(e instanceof ApiError && e.status === 404);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { info, missing, error, reload };
}

/** Origins (IP and .local) that appear in the agent's examples. */
export const baseUrls = (info: WebhookInfo | null): string[] => {
  const found = new Set<string>();
  for (const ex of info?.examples ?? []) for (const m of ex.matchAll(/https?:\/\/[^/\s"']+/g)) found.add(m[0]);
  return found.size ? [...found] : [location.origin];
};

/** curl one-liners. The key is a placeholder: set WEBHOOK_KEY in the shell. */
export const curlPush = (base: string, key: string, value = "42") => `curl -X POST -H "Authorization: Bearer $WEBHOOK_KEY" -H "Content-Type: application/json" -d '{"value":${value}}' ${base}/api/push/${key}`;
