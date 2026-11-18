import { useMemo, useState } from "react";
import { IconChevronDown as ChevronDown, IconSearch as Search } from "@tabler/icons-react";
import { useLanguage, t } from "@/lib/i18n";
import { Input } from "@/components/ui/knowns/input";
import { Popover } from "@/components/ui/knowns/popover";
import { useHassEntities } from "@/lib/hass";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/** Searchable list of Home Assistant entities; falls back to what is already set when HA is not reachable. */
export function EntityPicker({ value, onChange, domain }: { value: string; onChange: (id: string) => void; domain?: string }) {
  useLanguage();
  const { data, missing, loading } = useHassEntities();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const n = norm(q.trim());
    return (data ?? []).filter((e) => (!domain || e.domain === domain) && (!n || norm(`${e.name} ${e.id} ${e.area ?? ""}`).includes(n))).slice(0, 80);
  }, [data, q, domain]);
  const current = data?.find((e) => e.id === value);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) setQ(""); }}
      side="bottom"
      align="start"
      aria-label={t("Select entity")}
      className="w-[340px] p-2"
      trigger={
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 rounded-[9px] border bg-card px-3 text-left text-[13.5px] transition-colors hover:bg-muted">
          <span className="min-w-0 flex-1 truncate">{value ? (current ? `${current.name} · ${value}` : value) : <span className="text-muted-foreground">{loading ? t("Loading…") : t("Select entity…")}</span>}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <Input autoFocus size="sm" icon={<Search />} placeholder={t("Search by name, id or area…")} aria-label={t("Search entities")} value={q} onChange={(e) => setQ(e.target.value)} />
        {missing || !data ? (
          <p className="px-1 py-3 text-center text-[12.5px] text-muted-foreground">{missing ? t("Home Assistant is not connected. Set it up in the AI integration tab.") : t("Loading…")}</p>
        ) : list.length === 0 ? (
          <p className="px-1 py-3 text-center text-[12.5px] text-muted-foreground">{t("No entities match.")}</p>
        ) : (
          <ul className="kn-scroll-auto flex max-h-[260px] flex-col overflow-y-auto">
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => { onChange(e.id); setOpen(false); }} className={cn("flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-muted", e.id === value && "bg-primary/10")}>
                  <span className="truncate text-[13px] font-medium">{e.name}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground">{e.id}{e.area ? ` · ${e.area}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
