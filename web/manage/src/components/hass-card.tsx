import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/knowns/alert";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { Card, CardContent } from "@/components/ui/knowns/card";
import { Field, Input } from "@/components/ui/knowns/input";
import { Spinner } from "@/components/ui/knowns/spinner";
import { ApiError, api } from "@/api";
import { Icon } from "@/components/icon";
import { refreshHass } from "@/lib/hass";
import { t } from "@/lib/i18n";
import type { HassConfig } from "@/types";

/** Home Assistant connection: URL + Long-Lived Access Token. The token is write-only here. */
export function HassCard() {
  const [cfg, setCfg] = useState<HassConfig | null>(null);
  const [missing, setMissing] = useState(false);
  const [url, setUrl] = useState("");
  const [urlDirty, setUrlDirty] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"token" | "test" | "delete" | "url" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api.getHass();
      setCfg(c);
      setMissing(false);
      setUrl((cur) => (urlDirty ? cur : c.url ?? ""));
    } catch (e) {
      setMissing(e instanceof ApiError && e.status === 404);
      setCfg(null);
      if (!(e instanceof ApiError && e.status === 404)) setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    }
  }, [urlDirty]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string>) => {
    setBusy(kind);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: await fn() });
    } catch (e) {
      setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      await load();
      refreshHass();
    }
  };

  const saveUrl = () => run("url", async () => {
    await api.putHassUrl(url.trim());
    setUrlDirty(false);
    return t("Address saved.");
  });
  const saveToken = () => run("token", async () => {
    if (urlDirty) await api.putHassUrl(url.trim());
    await api.putHassToken(token.trim());
    setToken("");
    setUrlDirty(false);
    return t("Token saved.");
  });
  const test = () => run("test", async () => {
    const r = await api.testHass();
    if (r.ok === false || r.error) throw new Error(r.error ?? t("Could not connect"));
    return r.version ? t("Connected, Home Assistant {version}.", { version: r.version }) : t("Connected.");
  });
  const clear = () => run("delete", async () => {
    await api.deleteHassToken();
    return t("Token deleted.");
  });

  const status = !cfg ? null : cfg.connected ? "ok" : cfg.error ? "error" : cfg.hasToken && cfg.url ? "wait" : "none";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border bg-muted/50"><Icon name="home" size={22} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight">Home Assistant</h3>
            <p className="text-xs text-muted-foreground">{t("Control your home from the phone: lights, switches, scenes, sensors")}</p>
          </div>
          {missing ? <Badge tone="neutral" dot>{t("Agent not supported")}</Badge>
            : !cfg ? <Spinner label={t("Loading")} />
            : status === "ok" ? <Badge tone="success" dot>{t("Connected")}{cfg.version ? ` · ${cfg.version}` : ""}</Badge>
            : status === "error" ? <Badge tone="danger" dot>{t("Error")}</Badge>
            : status === "wait" ? <Badge tone="warning" dot>{t("Connecting")}</Badge>
            : <Badge tone="neutral" dot>{t("Not configured")}</Badge>}
        </div>

        {missing && <Alert tone="info">{t("This agent does not have /api/hass yet (404). Update the agent and reload the page.")}</Alert>}
        {cfg?.error && !cfg.connected && <Alert tone="danger">{cfg.error}</Alert>}
        {notice && <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

        {!missing && (
          <>
            <Field label={t("Home Assistant address")} id="ha-url" hint={t("For example: http://homeassistant.local:8123")}>
              <div className="flex gap-2">
                <Input id="ha-url" value={url} inputMode="url" autoComplete="off" placeholder="http://homeassistant.local:8123" onChange={(e) => { setUrl(e.target.value); setUrlDirty(true); }} />
                <Button variant="secondary" loading={busy === "url"} disabled={!urlDirty || !url.trim()} onClick={() => void saveUrl()}>{t("Save address")}</Button>
              </div>
            </Field>
            <Field label={t("Long-lived access token")} id="ha-token" hint={cfg?.hasToken ? t("Saved. The token is never shown again; enter a new token to replace it.") : t("Paste the token created in Home Assistant.")}>
              <div className="flex gap-2">
                <Input id="ha-token" type="password" value={token} autoComplete="new-password" spellCheck={false} placeholder={cfg?.hasToken ? t("•••••••• (Saved)") : "eyJ…"} onChange={(e) => setToken(e.target.value)} />
                <Button loading={busy === "token"} disabled={!token.trim()} onClick={() => void saveToken()}>{t("Save token")}</Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" loading={busy === "test"} disabled={!cfg?.hasToken && !token} onClick={() => void test()}>{t("Test connection")}</Button>
              <Button variant="destructive" loading={busy === "delete"} disabled={!cfg?.hasToken} onClick={() => void clear()}>{t("Delete token")}</Button>
              {cfg?.hasToken && <span className="text-xs text-muted-foreground">{t("Saved")}</span>}
            </div>
            <details className="rounded-lg border px-3 py-2 text-[12.5px] text-muted-foreground">
              <summary className="cursor-pointer text-foreground">{t("Create a long-lived access token")}</summary>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
                <li>{t("Open Home Assistant and click your name at the bottom of the sidebar (Profile).")}</li>
                <li>{t("Choose the Security tab and scroll down to “Long-lived access tokens”.")}</li>
                <li>{t("Click “Create token”, give it a name (e.g. PhoneDesk) and copy the token right away, because Home Assistant shows it only once.")}</li>
                <li>{t("Paste the token into the field above and click “Save token”. The token is stored only on this computer and is not sent to the phone.")}</li>
              </ol>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
