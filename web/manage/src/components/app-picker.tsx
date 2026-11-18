import { useEffect, useMemo, useState } from "react";
import { IconChevronDown as ChevronDown, IconSearch as Search } from "@tabler/icons-react";
import { ApiError, api, appIconUrl } from "@/api";
import { useLanguage, t } from "@/lib/i18n";
import { Popover } from "@/components/ui/knowns/popover";
import { Input } from "@/components/ui/knowns/input";
import { Spinner } from "@/components/ui/knowns/spinner";
import type { MacApp } from "@/types";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

let cache: MacApp[] | null = null;

export function useApps(): { apps: MacApp[] | null; error: string | null } {
  const [apps, setApps] = useState<MacApp[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cache) return;
    let live = true;
    api.getApps().then((a) => {
      cache = a;
      if (live) setApps(a);
    }).catch((e: unknown) => {
      if (live) setError(e instanceof ApiError && e.status === 404 ? t("The agent does not support the app list yet (/api/apps returned 404).") : e instanceof Error ? e.message : String(e));
    });
    return () => { live = false; };
  }, []);
  return { apps, error };
}

/** Searchable list of the Mac's installed apps with their icons. */
export function AppList({ onPick, selected, maxHeight = 260 }: { onPick: (app: MacApp) => void; selected?: string; maxHeight?: number }) {
  useLanguage();
  const { apps, error } = useApps();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = norm(q.trim());
    return (apps ?? []).filter((a) => !n || norm(a.name).includes(n) || a.bundleId.toLowerCase().includes(n));
  }, [apps, q]);

  return (
    <div className="flex flex-col gap-2">
      <Input autoFocus size="sm" icon={<Search />} placeholder={t("Search apps…")} aria-label={t("Search apps")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="kn-scroll-auto overflow-y-auto pr-1" style={{ maxHeight }}>
        {error && <p className="py-4 text-center text-[13px] text-muted-foreground">{error}</p>}
        {!error && !apps && <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-muted-foreground"><Spinner label={t("Loading")} /> {t("Loading apps…")}</div>}
        {apps && shown.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">{t("No apps match.")}</p>}
        <ul className="flex flex-col">
          {shown.map((a) => (
            <li key={a.bundleId}>
              <button
                type="button"
                onClick={() => onPick(a)}
                aria-pressed={selected === a.bundleId}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted ${selected === a.bundleId ? "bg-primary/10" : ""}`}
              >
                <img src={appIconUrl(a.bundleId)} alt="" width={24} height={24} loading="lazy" className="size-6 flex-none rounded-md object-contain" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.bundleId}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Button that opens the app list in a popover; shows the currently chosen `bundle:` app. */
export function AppPickerButton({ target, onPick }: { target: string; onPick: (app: MacApp) => void }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const { apps } = useApps();
  const id = target.startsWith("bundle:") ? target.slice(7) : undefined;
  const current = id ? apps?.find((a) => a.bundleId === id) : undefined;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      aria-label={t("Select app")}
      className="w-[340px] p-3"
      trigger={
        <button type="button" id="f-app" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-3 rounded-[9px] border bg-card px-3 text-left text-[13.5px] transition-colors hover:bg-muted">
          {id ? <img src={appIconUrl(id)} alt="" width={22} height={22} className="size-[22px] flex-none rounded-md object-contain" /> : <span className="size-[22px] flex-none" />}
          <span className="flex-1 truncate">{id ? (current?.name ?? id) : t("Select app…")}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      }
    >
      <AppList selected={id} onPick={(a) => { onPick(a); setOpen(false); }} />
    </Popover>
  );
}
