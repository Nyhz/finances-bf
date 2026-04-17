"use client";

import * as React from "react";
import { DataTable } from "@/src/components/ui/DataTable";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import type { AuditEvent } from "@/src/db/schema";
import { formatDateTime } from "@/src/lib/format";

function pretty(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditTable({ rows }: { rows: AuditEvent[] }) {
  const [selected, setSelected] = React.useState<AuditEvent | null>(null);

  return (
    <>
      <DataTable<AuditEvent>
        rows={rows}
        getRowKey={(r) => r.id}
        emptyState="No audit events yet."
        columns={[
          {
            key: "createdAt",
            header: "When",
            cell: (r) => formatDateTime(r.createdAt),
          },
          { key: "entityType", header: "Entity", cell: (r) => r.entityType },
          { key: "action", header: "Action", cell: (r) => r.action },
          { key: "actor", header: "Actor", cell: (r) => r.actorType },
          { key: "source", header: "Source", cell: (r) => r.source },
          {
            key: "detail",
            header: "",
            align: "right",
            cell: (r) => (
              <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>
                View
              </Button>
            ),
          },
        ]}
      />
      <Modal
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={
          selected
            ? `${selected.entityType} • ${selected.action}`
            : "Audit event"
        }
        description={
          selected ? `${selected.id} — ${formatDateTime(selected.createdAt)}` : undefined
        }
        className="max-w-3xl"
      >
        {selected && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Previous
              </h4>
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
                {pretty(selected.previousJson)}
              </pre>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Next
              </h4>
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
                {pretty(selected.nextJson)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
