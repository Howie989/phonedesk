import { useState } from "react";
import { IconCheck as Check, IconChevronDown as ChevronDown } from "@tabler/icons-react";
import { Popover } from "@/components/ui/knowns/popover";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TileStyle } from "@/types";

const HEX = /^#[0-9a-f]{6}$/i;

/** English source text, translated where shown. "" = follow the theme. */
const OPTIONS: { value: TileStyle | ""; label: string }[] = [
  { value: "", label: "Follow theme" },
  { value: "tint", label: "Soft" },
  { value: "solid", label: "Solid" },
  { value: "outline", label: "Outline" },
  { value: "ios", label: "iOS" },
];

/** A tiny preview of a tile fill in `color` (the item colour, or the theme accent). */
export function StyleSwatch({ style, color }: { style: TileStyle | ""; color: string }) {
  const c = HEX.test(color) ? color : "#22d3ee";
  const box = "grid h-5 w-7 flex-none place-items-center";
  switch (style) {
    case "tint": return <span aria-hidden className={cn(box, "rounded-[5px]")} style={{ background: `${c}33`, boxShadow: `inset 0 0 0 1px ${c}59` }} />;
    case "solid": return <span aria-hidden className={cn(box, "rounded-[5px]")} style={{ background: c }} />;
    case "outline": return <span aria-hidden className={cn(box, "rounded-[5px]")} style={{ boxShadow: `inset 0 0 0 1.5px ${c}` }} />;
    case "ios": return <span aria-hidden className={cn(box, "rounded-[8px]")} style={{ background: c }}><span className="size-1.5 rounded-full bg-white/90" /></span>;
    default: return <span aria-hidden className={cn(box, "rounded-[5px] border border-dashed border-muted-foreground/60")} />;
  }
}

/**
 * Tile fill style as a dropdown whose options show a swatch of the style. A custom listbox (a native select cannot draw
 * swatches). `follow` hides the "Follow theme" entry for the theme-level control, where it makes no sense.
 */
export function StyleSelect({ id, value, onChange, color, follow = true, label }: { id: string; value: TileStyle | ""; onChange: (v: TileStyle | "") => void; color: string; follow?: boolean; label: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const opts = OPTIONS.filter((o) => follow || o.value !== "");
  const cur = opts.find((o) => o.value === value) ?? opts[0]!;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      aria-label={label}
      className="w-[220px] p-1"
      trigger={
        <button type="button" id={id} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-8 w-full items-center gap-2.5 rounded-[9px] border bg-card px-2.5 text-left text-[13.5px] transition-colors hover:bg-muted pointer-coarse:h-10">
          <StyleSwatch style={cur.value} color={color} />
          <span className="flex-1 truncate">{t(cur.label)}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      }
    >
      <ul role="listbox" aria-label={label} className="flex flex-col">
        {opts.map((o) => (
          <li key={o.value || "follow"} role="option" aria-selected={o.value === cur.value}>
            <button type="button" onClick={() => { onChange(o.value); setOpen(false); }} className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px] transition-colors hover:bg-muted", o.value === cur.value && "bg-muted font-medium")}>
              <StyleSwatch style={o.value} color={color} />
              <span className="flex-1 truncate">{t(o.label)}</span>
              {o.value === cur.value && <Check className="size-4 text-primary" />}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
