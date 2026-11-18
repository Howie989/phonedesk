import { useEffect, useState } from "react";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Kbd } from "@/components/ui/knowns/kbd";
import { hotkeyFromEvent } from "@/lib/layout";
import { t, useLanguage } from "@/lib/i18n";
import { hotkeyLabels, usePlatform } from "@/lib/platform";

/** Key combination input with a recorder. */
export function HotkeyField({ value, onChange, id = "f-keys", label }: { value: string; onChange: (v: string) => void; id?: string; label?: string }) {
  useLanguage();
  const platform = usePlatform();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const combo = hotkeyFromEvent(e, platform);
      if (combo) {
        onChange(combo);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange, platform]);

  return (
    <Field label={label ?? t("Key combination")} id={id} hint={recording ? t("Listening... press a key combination (Esc to cancel).") : (platform === "win32" ? t("E.g. ctrl+shift+s, ctrl+alt+t, f5, return, space, up. Ctrl is written as cmd in the layout.") : t("E.g. cmd+shift+4, ctrl+alt+t, f5, return, space, up."))}>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder={platform === "win32" ? "cmd+shift+s" : "cmd+shift+4"} onChange={(e) => onChange(e.target.value)} onFocus={() => setRecording(false)} />
        <Button size="md" variant={recording ? "primary" : "secondary"} onClick={() => setRecording((r) => !r)} className="shrink-0">
          {recording ? t("Recording...") : t("Record keys")}
        </Button>
      </div>
      {value && (
        <div className="flex flex-wrap gap-1">
          {hotkeyLabels(value, platform).map((k, i) => <Kbd key={i} size="sm">{k}</Kbd>)}
        </div>
      )}
    </Field>
  );
}
