import { useLanguage, t } from "@/lib/i18n";
import { Select } from "@/components/ui/knowns/select";
import { actionSummary, itemTitle } from "@/lib/layout";
import type { Page } from "@/types";

/** Picks a button on any page: first the page, then the item. */
export function ItemRefPicker({ pages, pageId, itemId, onChange, idPrefix = "ref" }: { pages: Page[]; pageId: string; itemId: string; onChange: (pageId: string, itemId: string) => void; idPrefix?: string }) {
  useLanguage();
  const page = pages.find((p) => p.id === pageId);
  const items = (page?.items ?? []).filter((i) => i.kind === "button");
  const pageOk = !pageId || !!page;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select size="sm" id={`${idPrefix}-page`} aria-label={t("Page")} value={pageId} invalid={!pageOk}
        onChange={(e) => {
          const np = pages.find((p) => p.id === e.target.value);
          onChange(e.target.value, np?.items.find((i) => i.kind === "button")?.id ?? "");
        }}
        options={[{ value: "", label: t("Select page…") }, ...pages.map((p) => ({ value: p.id, label: p.name || p.id })), ...(pageOk ? [] : [{ value: pageId, label: `${pageId} (${t("does not exist")})` }])]} />
      <Select size="sm" id={`${idPrefix}-item`} aria-label={t("Button")} value={itemId} invalid={!!itemId && !items.some((i) => i.id === itemId)}
        onChange={(e) => onChange(pageId, e.target.value)}
        options={[{ value: "", label: t("Select button…") }, ...items.map((i) => ({ value: i.id, label: `${itemTitle(i)} · ${i.kind === "button" ? actionSummary(i.action) : ""}` })), ...(itemId && !items.some((i) => i.id === itemId) ? [{ value: itemId, label: `${itemId} (${t("does not exist")})` }] : [])]} />
    </div>
  );
}
