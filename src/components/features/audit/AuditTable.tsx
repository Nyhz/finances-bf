"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/cn";
import type { AuditEvent } from "@/src/db/schema";
import { formatDateTime } from "@/src/lib/format";

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function DiffView({
  previous,
  next,
}: {
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}) {
  const keys = React.useMemo(() => {
    const set = new Set<string>();
    if (previous) for (const k of Object.keys(previous)) set.add(k);
    if (next) for (const k of Object.keys(next)) set.add(k);
    return Array.from(set).sort();
  }, [previous, next]);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No payload recorded for this event.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="grid grid-cols-[minmax(8rem,auto)_1fr_1fr] border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <div className="px-3 py-2">Key</div>
        <div className="border-l border-border px-3 py-2">Previous</div>
        <div className="border-l border-border px-3 py-2">Next</div>
      </div>
      <div className="divide-y divide-border font-mono text-xs">
        {keys.map((key) => {
          const prevHas = previous ? key in previous : false;
          const nextHas = next ? key in next : false;
          const prevVal = prevHas ? previous![key] : undefined;
          const nextVal = nextHas ? next![key] : undefined;
          const changed =
            !prevHas || !nextHas || JSON.stringify(prevVal) !== JSON.stringify(nextVal);
          return (
            <div
              key={key}
              className={cn(
                "grid grid-cols-[minmax(8rem,auto)_1fr_1fr]",
                changed && "bg-warning/10",
              )}
            >
              <div className="px-3 py-1.5 font-medium text-foreground">{key}</div>
              <div
                className={cn(
                  "border-l border-border px-3 py-1.5 text-muted-foreground",
                  changed && prevHas && "text-destructive",
                )}
              >
                {prevHas ? renderValue(prevVal) : "—"}
              </div>
              <div
                className={cn(
                  "border-l border-border px-3 py-1.5 text-muted-foreground",
                  changed && nextHas && "text-success",
                )}
              >
                {nextHas ? renderValue(nextVal) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AuditTable({ rows }: { rows: AuditEvent[] }) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-2 py-2.5" />
              <th className="px-4 py-2.5 text-left">When</th>
              <th className="px-4 py-2.5 text-left">Entity</th>
              <th className="px-4 py-2.5 text-left">Entity id</th>
              <th className="px-4 py-2.5 text-left">Action</th>
              <th className="px-4 py-2.5 text-left">Actor</th>
              <th className="px-4 py-2.5 text-left">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = !!expanded[r.id];
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                    onClick={() => toggle(r.id)}
                  >
                    <td className="px-2 py-2.5 text-muted-foreground">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" aria-label="Collapse" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-label="Expand" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{r.entityType}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {r.entityId}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{r.action}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.actorType}</td>
                    <td className="px-4 py-2.5 text-foreground">{r.source}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border bg-muted/20 last:border-0">
                      <td />
                      <td colSpan={6} className="px-4 py-4">
                        {r.summary && (
                          <p className="mb-3 text-sm text-muted-foreground">
                            {r.summary}
                          </p>
                        )}
                        <DiffView
                          previous={parseJson(r.previousJson)}
                          next={parseJson(r.nextJson)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
