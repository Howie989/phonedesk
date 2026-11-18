import { useState, type ReactElement } from "react";
import { Popover } from "@/components/ui/knowns/popover";
import { t, useLanguage } from "@/lib/i18n";
import { WIDGET_HINT, WIDGET_LABEL } from "@/lib/layout";
import { WIDGET_KINDS, type WidgetKind } from "@/types";

/** Popover list of widget kinds. `trigger` must accept onClick and a ref (a Button does). */
export function WidgetMenu({ trigger, onPick, align = "start" }: {
  trigger: (toggle: () => void) => ReactElement<{ onClick?: (e: unknown) => void }>;
  onPick: (kind: WidgetKind) => void;
  align?: "start" | "end";
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} align={align} aria-label={t("Choose widget")} className="w-[280px] p-1.5" trigger={trigger(() => setOpen((o) => !o))}>
      <ul className="flex flex-col">
        {WIDGET_KINDS.filter((k) => k !== "entity").map((k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(k);
              }}
              className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="text-[13px] font-medium">{t(WIDGET_LABEL[k])}</span>
              <span className="text-[11.5px] text-muted-foreground">{t(WIDGET_HINT[k])}</span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
