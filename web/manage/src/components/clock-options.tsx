import { useId, useMemo, useState, type ReactNode } from "react";
import { IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Switch } from "@/components/ui/knowns/switch";
import { cn } from "@/lib/utils";
import { t, useLanguage } from "@/lib/i18n";
import { CLOCK_STYLES, type ClockOptions, type ClockStyle } from "@/types";

const FALLBACK_ZONES = [
  "Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Sao_Paulo", "Africa/Cairo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function zoneList(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = f?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : [...list, "UTC"];
  } catch {
    /* older browsers */
  }
  return FALLBACK_ZONES;
}

const isZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const STYLE_NAME: Record<ClockStyle, string> = { digital: "Large digits", flip: "Flip", analog: "Analog", minimal: "Minimal", word: "Words", world: "World" };

/** A few pixels of what each style looks like. */
function Thumb({ style }: { style: ClockStyle }) {
  const box = "grid h-9 w-full place-items-center rounded-md bg-muted/60 text-foreground";
  switch (style) {
    case "digital":
      return <span className={cn(box, "font-mono text-[15px] font-light tracking-tight")}>10:42</span>;
    case "flip":
      return (
        <span className={cn(box, "gap-0.5 grid-flow-col")}>
          {["1", "0", "4", "2"].map((d, i) => <span key={i} className="grid h-6 w-3.5 place-items-center rounded-[3px] bg-foreground/15 font-mono text-[12px] font-semibold">{d}</span>)}
        </span>
      );
    case "analog":
      return (
        <span className={box}>
          <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round">
            <circle cx="16" cy="16" r="13" strokeWidth="1.5" opacity=".5" />
            <path d="M16 16V8" strokeWidth="2" />
            <path d="M16 16l6 3" strokeWidth="1.5" />
          </svg>
        </span>
      );
    case "minimal":
      return <span className={cn(box, "text-[12px]")}>10:42</span>;
    case "word":
      return <span className={cn(box, "text-[10px] leading-tight")}>{t("ten o'clock")}<br />{t("ten to")}</span>;
    case "world":
      return (
        <span className={cn(box, "grid-cols-3 gap-1 px-1 text-[9px] leading-tight")}>
          {["10:42", "03:42", "21:42"].map((c) => <span key={c}>{c}</span>)}
        </span>
      );
  }
}

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-[13px]">{label}</label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function ZoneInput({ id, value, listId, placeholder, onCommit, trailing }: { id: string; value: string; listId: string; placeholder?: string; onCommit: (v: string) => void; trailing?: ReactNode }) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const commit = (v: string) => {
    const z = v.trim();
    if (z === "" ) { setBad(false); onCommit(""); return; }
    if (isZone(z)) { setBad(false); onCommit(z); } else setBad(true);
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        list={listId}
        size="sm"
        value={draft}
        invalid={bad}
        placeholder={placeholder}
        aria-label={placeholder ?? t("Time zone")}
        onChange={(e) => { setDraft(e.target.value); if (isZone(e.target.value.trim())) { setBad(false); onCommit(e.target.value.trim()); } }}
        onBlur={() => commit(draft)}
      />
      {trailing}
    </div>
  );
}

export function ClockOptionsForm({ value, onChange }: { value: ClockOptions | undefined; onChange: (next: ClockOptions | undefined) => void }) {
  useLanguage();
  const o = value ?? {};
  const uid = useId();
  const zones = useMemo(zoneList, []);
  const listId = `${uid}-zones`;
  const style: ClockStyle = o.style ?? "digital";
  const set = (patch: Partial<ClockOptions>) => {
    const next: ClockOptions = { ...o, ...patch };
    for (const k of Object.keys(next) as (keyof ClockOptions)[]) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    }
    onChange(Object.keys(next).length ? next : undefined);
  };
  const worldZones = o.zones ?? [];

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <Field label={t("Clock style")} id={`${uid}-style`}>
        <div role="radiogroup" aria-label={t("Clock style")} className="grid grid-cols-3 gap-2">
          {CLOCK_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={style === s}
              onClick={() => set({ style: s === "digital" ? undefined : s })}
              className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[12px] transition-colors hover:bg-muted", style === s && "border-primary bg-primary/10 font-medium")}
            >
              <Thumb style={s} />
              {t(STYLE_NAME[s])}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex flex-col gap-2">
        <SwitchRow id={`${uid}-sec`} label={t("Seconds")} checked={o.seconds ?? true} onChange={(v) => set({ seconds: v })} />
        <SwitchRow id={`${uid}-h12`} label={t("12-hour")} checked={o.hour12 ?? false} onChange={(v) => set({ hour12: v || undefined })} />
        <SwitchRow id={`${uid}-date`} label={t("Show date")} checked={o.showDate ?? true} onChange={(v) => set({ showDate: v })} />
      </div>

      {style !== "world" && (
        <Field label={t("Time zone")} id={`${uid}-tz`} hint={t("Leave empty to use the phone's time zone. Example: Asia/Tokyo.")}>
          <ZoneInput id={`${uid}-tz`} listId={listId} value={o.timeZone ?? ""} placeholder={t("Phone time zone")} onCommit={(v) => set({ timeZone: v })} />
        </Field>
      )}

      {style === "world" && (
        <Field label={t("Time zones ({n}/4)", { n: worldZones.length })} id={`${uid}-z0`} hint={t("Up to 4 time zones. The first one is the main clock.")}>
          <div className="flex flex-col gap-2">
            {worldZones.map((z, i) => (
              <ZoneInput
                key={`${i}-${z}`}
                id={i === 0 ? `${uid}-z0` : `${uid}-z${i}`}
                listId={listId}
                value={z}
                placeholder={t("Time zone {n}", { n: i + 1 })}
                onCommit={(v) => set({ zones: v ? worldZones.map((x, j) => (j === i ? v : x)) : worldZones.filter((_, j) => j !== i) })}
                trailing={<Button size="sm" variant="ghost" icon={<Trash />} aria-label={t("Remove time zone {n}", { n: i + 1 })} onClick={() => set({ zones: worldZones.filter((_, j) => j !== i) })} />}
              />
            ))}
            {worldZones.length < 4 && (
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => set({ zones: [...worldZones, FALLBACK_ZONES.find((z) => !worldZones.includes(z) && zones.includes(z)) ?? "UTC"] })}>{t("Add time zone")}</Button>
            )}
          </div>
        </Field>
      )}

      <Field label={t("Caption")} id={`${uid}-label`} optional={t("Optional")}>
        <Input id={`${uid}-label`} size="sm" value={o.label ?? ""} maxLength={40} placeholder={t("E.g. Tokyo")} onChange={(e) => set({ label: e.target.value })} />
      </Field>
    </div>
  );
}
