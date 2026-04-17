"use client";

import * as React from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { deleteCashMovement } from "@/src/actions/deleteCashMovement";
import { deleteTransaction } from "@/src/actions/deleteTransaction";
import { formatDateTime, formatEur } from "@/src/lib/format";

type Kind = "transaction" | "cash_movement";

export type AccountLedgerRow = {
  kind: Kind;
  id: string;
  occurredAt: number;
  label: string;
  amountEur: number;
  assetSymbol: string | null;
  quantity: number | null;
  description: string | null;
};

export type AccountLedgerProps = {
  rows: AccountLedgerRow[];
  nextHref: string | null;
  prevHref: string | null;
};

type Target = { kind: Kind; id: string; label: string };

function kindVariant(label: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (label) {
    case "buy":
    case "deposit":
    case "dividend":
    case "interest":
      return "success";
    case "sell":
    case "withdrawal":
    case "fee":
      return "warning";
    default:
      return "neutral";
  }
}

export function AccountLedger({ rows, nextHref, prevHref }: AccountLedgerProps) {
  const [target, setTarget] = React.useState<Target | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);

  async function onConfirm() {
    if (!target) return;
    const result =
      target.kind === "transaction"
        ? await deleteTransaction({ id: target.id })
        : await deleteCashMovement({ id: target.id });
    if (!result.ok) {
      setBanner(result.error.message);
      throw new Error(result.error.message);
    }
    setBanner(null);
  }

  return (
    <Card title="Ledger">
      {banner && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {banner}
        </div>
      )}
      <DataTable<AccountLedgerRow>
        rows={rows}
        getRowKey={(r) => `${r.kind}:${r.id}`}
        emptyState="No ledger entries for this account yet."
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (r) => formatDateTime(r.occurredAt),
          },
          {
            key: "kind",
            header: "Kind",
            cell: (r) => <Badge variant={kindVariant(r.label)}>{r.label}</Badge>,
          },
          {
            key: "detail",
            header: "Detail",
            cell: (r) => {
              if (r.kind === "transaction") {
                return (
                  <span className="text-muted-foreground">
                    {r.assetSymbol ?? "—"}
                    {r.quantity != null ? ` · ${r.quantity.toFixed(4)}` : ""}
                  </span>
                );
              }
              return (
                <span className="text-muted-foreground">{r.description ?? "—"}</span>
              );
            },
          },
          {
            key: "amount",
            header: "Amount (EUR)",
            align: "right",
            cell: (r) => {
              const color =
                r.amountEur > 0
                  ? "text-success"
                  : r.amountEur < 0
                    ? "text-destructive"
                    : "";
              return (
                <SensitiveValue className={color}>
                  {formatEur(r.amountEur)}
                </SensitiveValue>
              );
            },
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (r) => (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${r.label}`}
                onClick={() => {
                  setBanner(null);
                  setTarget({ kind: r.kind, id: r.id, label: r.label });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ),
          },
        ]}
        footer={
          <>
            <span>{rows.length} rows</span>
            <span className="flex items-center gap-2">
              {prevHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={prevHref}>Prev</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Prev
                </Button>
              )}
              {nextHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={nextHref}>Next</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Next
                </Button>
              )}
            </span>
          </>
        }
      />

      <ConfirmModal
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title={`Delete ${target?.label ?? "entry"}?`}
        description="This reverses position and cash impact where applicable, and writes an audit event. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />
    </Card>
  );
}
