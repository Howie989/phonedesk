import { IconBan as Ban } from "@tabler/icons-react";
import { Input } from "@/components/ui/knowns/input";
import { cn } from "@/lib/utils";
import { t, useLanguage } from "@/lib/i18n";

/** hass-ui palette. The first entry (none) means "use the theme default". */
export const PALETTE: { name: string; value: string | undefined }[] = [
  { name: "Default", value: undefined },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Sky blue", value: "#38bdf8" },
  { name: "Green", value: "#34d399" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Red", value: "#f87171" },
  { name: "Gray", value: "#a1a1aa" },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({ id, value, onChange, fallback = "#22d3ee", noneLabel, withText = false }: {
  id?: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  /** Starting color of the custom picker when no color is set. */
  fallback?: string;
  noneLabel?: string;
  /** Also show a text input (accepts any CSS color the agent allows). */
  withText?: boolean;
}) {
  useLanguage();
  const none = noneLabel ?? t("Default");
  const isPreset = PALETTE.some((p) => p.value?.toLowerCase() === value?.toLowerCase());
  const custom = !!value && !isPreset;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("Color")}>
        {PALETTE.map((p) => {
          const on = (p.value ?? "") === (value ?? "") || (p.value && value && p.value.toLowerCase() === value.toLowerCase());
          return (
            <button
              key={p.name}
              type="button"
              role="radio"
              aria-checked={!!on}
              aria-label={p.value ? t(p.name) : none}
              title={p.value ? t(p.name) : none}
              onClick={() => onChange(p.value)}
              className={cn(
                "grid size-7 place-items-center rounded-full border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card",
              )}
              style={p.value ? { background: p.value, borderColor: "transparent" } : undefined}
            >
              {!p.value && <Ban className="size-3.5 text-muted-foreground" />}
            </button>
          );
        })}
        <label
          title={t("Custom color")}
          className={cn(
            "relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full border transition-transform hover:scale-110",
            custom && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card",
          )}
          style={{ background: custom && HEX.test(value!) ? value : "conic-gradient(#f87171,#f59e0b,#34d399,#38bdf8,#8b5cf6,#f87171)" }}
        >
          <input
            type="color"
            aria-label={t("Custom color")}
            value={value && HEX.test(value) ? value : fallback}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      {withText && (
        <Input id={id} size="sm" value={value ?? ""} placeholder={t("#rrggbb or a color name")} onChange={(e) => onChange(e.target.value.trim() || undefined)} />
      )}
    </div>
  );
}
