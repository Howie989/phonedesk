import { useId } from "react";
import { Field } from "@/components/ui/knowns/input";
import { Select } from "@/components/ui/knowns/select";
import { Switch } from "@/components/ui/knowns/switch";
import { cn } from "@/lib/utils";
import { t, useLanguage } from "@/lib/i18n";
import { METRIC_CHARTS_FOR, type MetricChart, type MetricOptions, type MetricWidget } from "@/types";

const NAME: Record<MetricChart, string> = {
  sparkline: "Line", area: "Area", bars: "Columns", gauge: "Gauge", ring: "Ring", bar: "Bar", number: "Number", donut: "Donut",
};

const WINDOWS: { value: 60 | 300 | 900; label: string }[] = [
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
];

const LINE = "M2 20 L9 14 L15 17 L22 8 L29 12 L36 5 L44 9";

/** Tiny picture of each chart type, drawn in currentColor. */
function Thumb({ chart }: { chart: MetricChart | "auto" }) {
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 46 26" className="h-7 w-full" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
  switch (chart) {
    case "sparkline":
      return svg(<><path d={LINE} strokeWidth="1.8" /><circle cx="44" cy="9" r="1.8" fill="currentColor" stroke="none" /></>);
    case "area":
      return svg(<><path d={`${LINE} L44 24 L2 24 Z`} fill="currentColor" fillOpacity=".25" stroke="none" /><path d={LINE} strokeWidth="1.6" /></>);
    case "bars":
      return svg(<>{[6, 11, 8, 15, 12, 19, 14].map((h, i) => <rect key={i} x={3 + i * 6} y={24 - h} width="4" height={h} rx="1" fill="currentColor" stroke="none" opacity={0.4 + i * 0.09} />)}</>);
    case "gauge":
      return svg(<><path d="M9 22 A14 14 0 0 1 37 22" strokeWidth="3" opacity=".25" /><path d="M9 22 A14 14 0 0 1 28 9" strokeWidth="3" /></>);
    case "ring":
      return svg(<><circle cx="23" cy="13" r="9" strokeWidth="3" opacity=".25" /><path d="M23 4 A9 9 0 1 1 14.5 16" strokeWidth="3" /></>);
    case "bar":
      return svg(<><rect x="4" y="10" width="38" height="6" rx="3" fill="currentColor" fillOpacity=".25" stroke="none" /><rect x="4" y="10" width="24" height="6" rx="3" fill="currentColor" stroke="none" /></>);
    case "number":
      return <span className="grid h-7 place-items-center font-mono text-[14px] font-semibold leading-none">37%</span>;
    case "donut":
      return svg(<><circle cx="23" cy="13" r="8" strokeWidth="6" opacity=".25" /><circle cx="23" cy="13" r="8" strokeWidth="6" strokeDasharray="30 50" transform="rotate(-90 23 13)" /></>);
    case "auto":
      return <span className="grid h-7 place-items-center text-[11px] text-muted-foreground">{t("auto")}</span>;
  }
}

export function MetricOptionsForm({ widget, value, onChange }: { widget: MetricWidget; value: MetricOptions | undefined; onChange: (next: MetricOptions | undefined) => void }) {
  useLanguage();
  const o = value ?? {};
  const uid = useId();
  const allowed = METRIC_CHARTS_FOR[widget];
  const chart = o.chart && allowed.includes(o.chart) ? o.chart : undefined;
  const set = (patch: Partial<MetricOptions>) => {
    const next: MetricOptions = { ...o, ...patch };
    for (const k of Object.keys(next) as (keyof MetricOptions)[]) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const showsHistory = !chart || chart === "sparkline" || chart === "area" || chart === "bars";

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("Chart style")} id={`${uid}-chart`}>
        <div role="radiogroup" aria-label={t("Chart style")} className="grid grid-cols-3 gap-2">
          {(["auto", ...allowed] as const).map((c) => {
            const on = c === "auto" ? !chart : chart === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ chart: c === "auto" ? undefined : c })}
                className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[12px] transition-colors hover:bg-muted", on && "border-primary bg-primary/10 font-medium")}
              >
                <span className="w-full rounded-md bg-muted/60 px-1 py-0.5 text-foreground"><Thumb chart={c} /></span>
                {c === "auto" ? t("Default") : t(NAME[c])}
              </button>
            );
          })}
        </div>
      </Field>

      {showsHistory && (
        <Field label={t("History")} id={`${uid}-window`}>
          <Select
            id={`${uid}-window`}
            value={String(o.window ?? "")}
            onChange={(e) => set({ window: e.target.value ? (Number(e.target.value) as 60 | 300 | 900) : undefined })}
            options={[{ value: "", label: t("Default (about 2 minutes)") }, ...WINDOWS.map((w) => ({ value: String(w.value), label: t(w.label) }))]}
          />
        </Field>
      )}

      <div className="flex flex-col gap-2">
        {([["showDelta", t("Show change")], ["showSub", t("Show sub line")]] as const).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <label htmlFor={`${uid}-${k}`} className="text-[13px]">{label}</label>
            <Switch id={`${uid}-${k}`} checked={o[k] ?? true} onCheckedChange={(v) => set({ [k]: v })} aria-label={label} />
          </div>
        ))}
      </div>
    </div>
  );
}
