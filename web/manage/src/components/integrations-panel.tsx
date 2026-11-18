import { useCallback, useEffect, useState } from "react";
import { WebhookCard } from "@/components/webhook-card";
import { HassCard } from "@/components/hass-card";
import { Icon } from "@/components/icon";
import { IconShieldCheck as ShieldCheck } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { Card, CardContent } from "@/components/ui/knowns/card";
import { Dialog } from "@/components/ui/knowns/dialog";
import { Spinner } from "@/components/ui/knowns/spinner";
import { Switch } from "@/components/ui/knowns/switch";
import { ApiError, api } from "@/api";
import { getLanguage, t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AiProvider, Integration } from "@/types";

interface Info {
  id: AiProvider;
  name: string;
  reads: string;
  defaultPath?: string;
}

/** `reads` is English source text: translated where it is shown. */
const TOOLS: Info[] = [
  {
    id: "claude",
    name: "Claude Code",
    reads: "Reads your quota from the Claude Code sign-in already on this Mac, plus session metadata (project, state, time). Never reads the content of questions or answers.",
    defaultPath: "~/.claude/settings.json",
  },
  {
    id: "codex",
    name: "Codex",
    reads: "Reads your quota from the Codex session files on this Mac, plus session metadata (project, state, time). Never reads the content of questions or answers.",
    defaultPath: "~/.codex/hooks.json",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    reads: "Reads your quota with Antigravity's \"agy /usage\" command (no question is sent to a model). Asking permission on the phone is not supported yet.",
  },
];

function when(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString(getLanguage() === "vi" ? "vi-VN" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Read-only quota bars, one per window. Plain markup: no extra component needed. */
function QuotaBars({ info }: { info: Integration }) {
  if (info.windows.length === 0) return null;
  const resets = info.windows.map((x) => x.resetsAt).filter((x): x is string => !!x).sort()[0];
  const resetText = when(resets);
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold">{t("{name} quota", { name: info.name })}</h4>
        {resetText && <span className="text-xs text-muted-foreground">{t("Resets {time}", { time: resetText })}</span>}
      </div>
      {info.windows.map((w) => {
        const pct = Math.round(w.usedPercent);
        return (
          <div key={w.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span>{w.label}</span>
              <span className="tabular-nums text-muted-foreground">{pct}%</span>
            </div>
            <div role="progressbar" aria-label={w.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function IntegrationsPanel() {
  useLanguage();
  const [items, setItems] = useState<Integration[] | null>(null);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);
  const [busy, setBusy] = useState<AiProvider | null>(null);
  const [confirm, setConfirm] = useState<AiProvider | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { integrations: list } = await api.getIntegrations();
      setItems(list);
      setError(null);
    } catch (e) {
      setItems([]);
      setError({
        message: e instanceof ApiError && e.status === 404
          ? t("This agent does not support AI integrations yet (/api/integrations returned 404). Update the agent and reload the page.")
          : e instanceof Error ? e.message : String(e),
        missing: e instanceof ApiError && e.status === 404,
      });
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  const setHook = async (id: AiProvider, on: boolean) => {
    setBusy(id);
    setNotice(null);
    try {
      if (on) await api.enableHook(id);
      else await api.disableHook(id);
      setNotice({ tone: "success", text: on ? t("Permission prompts on the phone are on.") : t("Permission prompts on the phone are off. PhoneDesk's hook was removed.") });
      await load();
    } catch (e) {
      setNotice({ tone: "danger", text: t("Could not change the setting: {error}", { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };

  const target = confirm ? TOOLS.find((x) => x.id === confirm)! : null;
  const targetPath = confirm ? items?.find((i) => i.id === confirm)?.hook?.settingsPath ?? target?.defaultPath : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t("PhoneDesk shows your AI quota and running AI sessions on the phone. It reads metadata only and never sends the content of questions or answers.")}
      </p>
      <HassCard />
      <WebhookCard />
      {error && <Alert tone={error.missing ? "info" : "danger"} action={{ label: t("Retry"), onClick: () => void load() }}>{error.message}</Alert>}
      {notice && <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      {!items && <Spinner label={t("Loading")} />}
      {items && TOOLS.map((tool) => {
        const info = items.find((i) => i.id === tool.id);
        return (
          <ToolCard key={tool.id} tool={tool} info={info} onChanged={() => void load()} backendMissing={!!error} busy={busy === tool.id} onToggle={(on) => (on ? setConfirm(tool.id) : void setHook(tool.id, false))} />
        );
      })}

      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("Ask permission on the phone for {name}?", { name: target?.name ?? "" })}
        description={t("PhoneDesk will add a hook to this tool's settings file.")}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>{t("Cancel")}</Button>
            <Button icon={<ShieldCheck />} onClick={() => { const id = confirm!; setConfirm(null); void setHook(id, true); }}>{t("Agree, turn on")}</Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>{t("File that will be changed:")} <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{targetPath ?? t("(the agent did not report a path)")}</code></li>
          <li>{t("A backup is written before editing:")} <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{targetPath ? `${targetPath}.phonedesk.bak` : "*.phonedesk.bak"}</code></li>
          <li>{t("Other hooks in the file are kept. You can turn this off again at any time with the same switch.")}</li>
          <li>{t("If the phone does not answer (not connected or timed out), the tool asks for permission in the terminal as usual.")}</li>
        </ul>
      </Dialog>
    </div>
  );
}

function ToolCard({ tool, info, onChanged, backendMissing, busy, onToggle }: {
  tool: Info;
  info: Integration | undefined;
  onChanged: () => void;
  backendMissing: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  const hookable = tool.id !== "antigravity";
  const status = info?.status ?? "unknown";
  const time = when(info?.updatedAt);
  // Read-only: where the quota comes from. The agent may send a human reason; otherwise a generic note.
  const source = info?.reason ?? (info?.source === "local" ? t("Read from local files") : info?.source ? t("Read from the {name} sign-in", { name: tool.name }) : undefined);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border bg-muted/50"><Icon name={tool.id} size={22} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight">{tool.name}</h3>
            <p className="text-xs text-muted-foreground">{info?.plan ? t("{plan} plan", { plan: info.plan }) : t("Quota and sessions")}</p>
          </div>
          {backendMissing ? (
            <Badge tone="neutral" dot>{t("No data")}</Badge>
          ) : status === "ok" ? (
            <Badge tone="success" dot>{time ? t("Quota read · {time}", { time }) : t("Quota read")}</Badge>
          ) : status === "error" ? (
            <Badge tone="danger" dot>{t("Error")}</Badge>
          ) : (
            <Badge tone="warning" dot>{t("Unknown")}</Badge>
          )}
        </div>
        {info && <QuotaBars info={info} />}
        {info?.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{info.error}</p>}
        {source && (
          <p className="text-xs text-muted-foreground">
            {t("Source:")} <span className="font-medium text-foreground">{source}</span>
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t(tool.reads)}</p>
        {tool.id === "claude" && <AskHookSection info={info} disabled={backendMissing || !info} onChanged={onChanged} />}
        {hookable && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0">
              <label htmlFor={`hook-${tool.id}`} className="text-[13px] font-medium">{t("Ask permission on the phone")}</label>
              <p className="text-xs text-muted-foreground">{t("When {name} needs permission, the phone shows an Allow / Deny dialog.", { name: tool.name })}</p>
            </div>
            <Switch
              id={`hook-${tool.id}`}
              aria-label={t("Ask permission on the phone for {name}", { name: tool.name })}
              checked={!!info?.hook?.enabled}
              disabled={busy || backendMissing || !info || info.hook?.supported === false}
              onCheckedChange={onToggle}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Switch for the AskUserQuestion hook: Claude Code asks its questions on the phone. */
function AskHookSection({ info, disabled, onChanged }: { info: Integration | undefined; disabled: boolean; onChanged: () => void }) {
  useLanguage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = !!info?.askHook?.enabled;
  const idleOnly = !!info?.askHook?.idleOnly;
  const path = info?.hook?.settingsPath ?? "~/.claude/settings.json";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(t("Could not change the setting: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor="ask-hook" className="text-[13px] font-medium">{t("Answer Claude's questions on the phone")}</label>
          <p className="text-xs text-muted-foreground">{t("When Claude Code asks you to pick an option, the question appears on the phone. Claude waits for the phone for up to 10 minutes. You can always answer at the computer: press \"Answer on computer\" on the phone, or just have no phone connected.")}</p>
        </div>
        <Switch id="ask-hook" aria-label={t("Answer Claude's questions on the phone")} checked={on} disabled={busy || disabled}
          onCheckedChange={(v) => (v ? setConfirm(true) : void run(() => api.disableAskHook()))} />
      </div>
      {on && (
        <div className="flex items-center justify-between gap-3 pl-1">
          <label htmlFor="ask-idle" className="text-[13px]">{t("Only when I am away from the keyboard (1 minute without mouse or keys)")}</label>
          <Switch id="ask-idle" aria-label={t("Only when I am away from the keyboard")} checked={idleOnly} disabled={busy} onCheckedChange={(v) => void run(() => api.enableAskHook(v))} />
        </div>
      )}
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Answer Claude's questions on the phone?")}
        description={t("PhoneDesk will add a second hook to Claude Code's settings file.")}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>{t("Cancel")}</Button>
            <Button icon={<ShieldCheck />} onClick={() => { setConfirm(false); void run(() => api.enableAskHook(idleOnly)); }}>{t("Agree, turn on")}</Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>{t("File that will be changed:")} <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{path}</code> {t("(a PreToolUse hook for AskUserQuestion, separate from the permission hook).")}</li>
          <li>{t("A backup is written before editing:")} <code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{path}.phonedesk.bak</code></li>
          <li>{t("Other hooks in the file are kept. Turning this switch off removes only PhoneDesk's hook.")}</li>
          <li>{t("If the phone does not answer or is not connected, Claude asks in the terminal as usual.")}</li>
        </ul>
      </Dialog>
    </div>
  );
}
