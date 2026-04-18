import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur } from "@/src/lib/format";
import type { AccountCashMovement } from "@/src/db/schema";

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function badgeForType(type: string) {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const color =
    type === "deposit" || type === "interest"
      ? "text-success"
      : type === "withdrawal" || type === "fee"
        ? "text-destructive"
        : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

export function SavingsMovementsTable({
  rows,
}: {
  rows: AccountCashMovement[];
}) {
  if (rows.length === 0) {
    return (
      <Card title="Recent movements">
        <StatesBlock
          mode="empty"
          title="No movements"
          description="No cash movements in the selected range."
        />
      </Card>
    );
  }
  return (
    <Card title="Recent movements">
      <DataTable<AccountCashMovement>
        rows={rows}
        getRowKey={(r) => r.id}
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (r) => formatDate(r.occurredAt),
          },
          {
            key: "type",
            header: "Type",
            cell: (r) => badgeForType(r.movementType),
          },
          {
            key: "description",
            header: "Description",
            cell: (r) => (
              <span className="text-muted-foreground">
                {r.description ?? r.externalReference ?? "—"}
              </span>
            ),
          },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            cell: (r) => {
              const color =
                r.cashImpactEur > 0
                  ? "text-success"
                  : r.cashImpactEur < 0
                    ? "text-destructive"
                    : "";
              return (
                <SensitiveValue className={`tabular-nums ${color}`}>
                  {formatEur(r.cashImpactEur)}
                </SensitiveValue>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
