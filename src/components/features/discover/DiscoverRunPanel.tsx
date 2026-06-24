"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, Sparkles, X } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/cn";

type VerifyLine = {
  symbol: string;
  name: string;
  status: "confirmed" | "refuted" | "unverifiable";
  detail: string;
};

type DiscoverEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "found"; count: number }
  | ({ type: "verify"; index: number; total: number } & VerifyLine)
  | { type: "done"; confirmedCount: number; summary: string }
  | { type: "error"; message: string };

export function DiscoverRunPanel({ header }: { header?: React.ReactNode }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [phase, setPhase] = React.useState("");
  const [thinking, setThinking] = React.useState("");
  const [lines, setLines] = React.useState<VerifyLine[]>([]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const thinkingRef = React.useRef<HTMLPreElement>(null);

  React.useEffect(() => {
    const el = thinkingRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thinking]);

  function handle(ev: DiscoverEvent) {
    switch (ev.type) {
      case "status":
        setPhase(ev.message);
        break;
      case "thinking":
        setThinking((t) => (t + ev.text).slice(-4000));
        break;
      case "found":
        setPhase(`${ev.count} candidatas encontradas — verificando…`);
        setProgress({ done: 0, total: ev.count });
        break;
      case "verify":
        setLines((ls) => [...ls, { symbol: ev.symbol, name: ev.name, status: ev.status, detail: ev.detail }]);
        setProgress({ done: ev.index, total: ev.total });
        break;
      case "done":
        setSummary(ev.summary);
        setPhase("Hecho");
        router.refresh();
        break;
      case "error":
        setError(ev.message);
        break;
    }
  }

  async function run() {
    setRunning(true);
    setPhase("Iniciando…");
    setThinking("");
    setLines([]);
    setProgress(null);
    setSummary(null);
    setError(null);
    try {
      const res = await fetch("/api/discover/run", { method: "POST" });
      if (!res.body) throw new Error("Sin stream de respuesta");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          try {
            handle(JSON.parse(trimmed.slice(5).trim()) as DiscoverEvent);
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setRunning(false);
    }
  }

  const active = running || lines.length > 0 || thinking.length > 0 || summary != null || error != null;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        {header}
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Descubriendo…" : "Descubrir ahora"}
        </Button>
      </div>

      {active && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          {/* Current phase + outcome. */}
          <div className="flex items-center gap-2 text-sm">
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {running && <span className="text-muted-foreground">{phase}</span>}
            {!running && summary && <span className="text-success">✓ {summary}</span>}
            {!running && error && <span className="text-destructive">⚠ {error}</span>}
          </div>

          {/* Agent narration — its live "mental process". */}
          {thinking && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Proceso del agente
              </span>
              <pre
                ref={thinkingRef}
                className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground"
              >
                {thinking}
                {running && <span className="animate-pulse">▍</span>}
              </pre>
            </div>
          )}

          {/* Verification progress. */}
          {progress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Verificación con datos reales</span>
                <span className="tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {lines.map((l, i) => (
                <li key={`${l.symbol}-${i}`} className="flex items-center gap-2">
                  <StatusIcon status={l.status} />
                  <span className="font-medium">{l.symbol}</span>
                  <span className="truncate text-muted-foreground">{l.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: VerifyLine["status"] }) {
  if (status === "confirmed") return <Check className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "refuted") return <X className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Minus className={cn("h-3.5 w-3.5 shrink-0 text-warning")} />;
}
