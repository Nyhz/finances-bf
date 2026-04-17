import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur } from "@/src/lib/format";
import type { PositionRow } from "@/src/server/positions";

export function AccountPositionsTable({ rows }: { rows: PositionRow[] }) {
  if (rows.length === 0) {
    return (
      <Card title="Positions">
        <StatesBlock
          mode="empty"
          title="No positions"
          description="This account holds no open positions."
        />
      </Card>
    );
  }

  return (
    <Card title="Positions">
      <DataTable<PositionRow>
        rows={rows}
        getRowKey={(r) => r.position.id}
        columns={[
          {
            key: "asset",
            header: "Asset",
            cell: (r) => r.asset.symbol ?? r.asset.name,
          },
          {
            key: "quantity",
            header: "Quantity",
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">{r.position.quantity.toFixed(4)}</span>
            ),
          },
          {
            key: "avgCost",
            header: "Avg Cost (EUR)",
            align: "right",
            cell: (r) => (
              <SensitiveValue>{formatEur(r.position.averageCost)}</SensitiveValue>
            ),
          },
          {
            key: "marketValue",
            header: "Market Value (EUR)",
            align: "right",
            cell: (r) =>
              r.valuationEur == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <SensitiveValue>{formatEur(r.valuationEur)}</SensitiveValue>
              ),
          },
          {
            key: "pnl",
            header: "Unrealized P/L (EUR)",
            align: "right",
            cell: (r) => {
              if (r.valuationEur == null) {
                return <span className="text-muted-foreground">—</span>;
              }
              const pnl = r.valuationEur - r.position.quantity * r.position.averageCost;
              const color =
                pnl > 0 ? "text-success" : pnl < 0 ? "text-destructive" : "";
              return (
                <SensitiveValue className={color}>{formatEur(pnl)}</SensitiveValue>
              );
            },
          },
        ]}
      />
    </Card>
  );
}
