import { useEffect, useRef, useState } from "react";
import { useLanguage, t } from "@/lib/i18n";
import { Alert } from "@/components/ui/knowns/alert";
import { normalizeLayout, shapeError } from "@/lib/layout";
import type { Layout } from "@/types";

/**
 * Raw JSON editor. Valid edits flow into the layout at once; invalid JSON is kept in the box and
 * reported through onError (saving is blocked until it parses). Remount (key) to resync from the layout.
 */
export function JsonPanel({ layout, onChange, onError }: { layout: Layout; onChange: (l: Layout) => void; onError: (msg: string | null) => void }) {
  useLanguage();
  const [text, setText] = useState(() => JSON.stringify(layout, null, 2));
  const [error, setError] = useState<string | null>(null);
  const errRef = useRef(onError);
  errRef.current = onError;
  useEffect(() => () => errRef.current(null), []);

  const edit = (value: string) => {
    setText(value);
    try {
      const parsed: unknown = JSON.parse(value);
      const bad = shapeError(parsed);
      if (bad) throw new Error(bad);
      setError(null);
      onError(null);
      onChange(normalizeLayout(parsed as Layout));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onError(msg);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("Edit the layout JSON directly. Valid changes apply at once; invalid JSON blocks saving and is discarded when you switch tabs.")}
      </p>
      {error && <Alert tone="danger" title={t("Invalid JSON")}>{error}</Alert>}
      <textarea
        aria-label={t("Layout JSON")}
        spellCheck={false}
        value={text}
        onChange={(e) => edit(e.target.value)}
        aria-invalid={!!error}
        className="min-h-[60vh] w-full resize-y rounded-xl border bg-card p-3 font-mono text-[12.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
    </div>
  );
}
