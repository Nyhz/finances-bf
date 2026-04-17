import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur, formatPercent } from "@/src/lib/format";
import type { TopPositionRow } from "@/src/server/overview";

export function TopPositionsTable({ rows }: { rows: TopPositionRow[] }) {
  if (rows.length === 0) {
    return (
      <Card title="Top positions">
        <StatesBlock
          mode="empty"
          title="No positions"
          description="No open positions for the selected filters."
        />
      </Card>
    );
  }

  return (
    <Card title="Top positions">
      <DataTable<TopPositionRow>
        rows={rows}
        getRowKey={(r) => r.position.position.id}
        columns={[
          {
            key: "asset",
            header: "Asset",
            cell: (r) => r.position.asset.symbol ?? r.position.asset.name,
          },
          {
            key: "account",
            header: "Account",
            cell: (r) => (
              <span className="text-muted-foreground">{r.accountLabel}</span>
            ),
          },
          {
            key: "qty",
            header: "Quantity",
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">
                {r.position.position.quantity.toFixed(4)}
              </span>
            ),
          },
          {
            key: "marketValue",
            header: "Market Value (EUR)",
            align: "right",
            cell: (r) =>
              r.position.valuationEur == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <SensitiveValue>
                  {formatEur(r.position.valuationEur)}
                </SensitiveValue>
              ),
          },
          {
            key: "weight",
            header: "Weight",
            align: "right",
            cell: (r) => (
              <span className="tabular-nums text-muted-foreground">
                {formatPercent(r.weight)}
              </span>
            ),
          },
          {
            key: "pnl",
            header: "Unrealized P/L (EUR)",
            align: "right",
            cell: (r) => {
              if (r.pnlEur == null) {
                return <span className="text-muted-foreground">—</span>;
              }
              const color =
                r.pnlEur > 0
                  ? "text-success"
                  : r.pnlEur < 0
                    ? "text-destructive"
                    : "";
              return (
                <SensitiveValue className={color}>
                  {formatEur(r.pnlEur)}
                </SensitiveValue>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
