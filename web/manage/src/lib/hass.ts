import { useEffect, useState } from "react";
import { ApiError, api } from "@/api";
import type { HassEntity, HassService } from "@/types";

type Cached<T> = { data: T | null; error: string | null; missing: boolean; loading: boolean };

function store<T>(load: () => Promise<T>) {
  let state: Cached<T> = { data: null, error: null, missing: false, loading: false };
  const listeners = new Set<() => void>();
  const set = (s: Partial<Cached<T>>) => {
    state = { ...state, ...s };
    listeners.forEach((l) => l());
  };
  const refresh = () => {
    if (state.loading) return;
    set({ loading: true });
    load().then(
      (data) => set({ data, error: null, missing: false, loading: false }),
      (e: unknown) => {
        // 404 = old agent; 400/409/503 = Home Assistant not configured or not connected yet.
        const missing = e instanceof ApiError && [400, 404, 409, 412, 424, 503].includes(e.status);
        set({ loading: false, error: e instanceof Error ? e.message : String(e), missing });
      },
    );
  };
  const use = () => {
    const [, tick] = useState(0);
    useEffect(() => {
      const l = () => tick((n) => n + 1);
      listeners.add(l);
      if (!state.data && !state.loading) refresh();
      return () => void listeners.delete(l);
    }, []);
    return { ...state, reload: refresh };
  };
  return { use, refresh };
}

const entities = store<HassEntity[]>(() => api.getHassEntities());
const services = store<HassService[]>(() => api.getHassServices());

/** Entities of the connected Home Assistant. `missing` = not configured / not connected (or an old agent). */
export const useHassEntities = entities.use;
export const useHassServices = services.use;
/** After the HA settings change, drop what we know and ask again. */
export const refreshHass = () => {
  entities.refresh();
  services.refresh();
};
