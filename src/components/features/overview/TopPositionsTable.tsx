import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { formatEur, formatPercent } from "@/src/lib/format";
import type { TopPositionRow } from "@/src/server/overview";
import { PositionSparkline } from "./PositionSparkline";

function formatUnit(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

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
            className: "w-[220px]",
            cell: (r) => {
              const a = r.position.asset;
              const symbol = a.providerSymbol ?? a.symbol ?? a.name;
              return (
                <div className="flex flex-col leading-tight">
                  <span className="font-medium tabular-nums">{symbol}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[26ch]">
                    {a.name}
                  </span>
                </div>
              );
            },
          },
          {
            key: "qty",
            header: "Quantity",
            align: "right",
            cell: (r) => (
              <span className="tabular-nums">
                {r.position.position.quantity.toLocaleString("es-ES", {
                  maximumFractionDigits: 4,
                })}
              </span>
            ),
          },
          {
            key: "avgBuy",
            header: "Avg buy / unit",
            align: "right",
            cell: (r) => (
              <SensitiveValue className="tabular-nums">
                {formatUnit(r.averageCostEur)}
              </SensitiveValue>
            ),
          },
          {
            key: "currentUnit",
            header: "Current / unit",
            align: "right",
            cell: (r) => (
              <SensitiveValue className="tabular-nums">
                {formatUnit(r.unitPriceEur)}
              </SensitiveValue>
            ),
          },
          {
            key: "currentTotal",
            header: "Current / total",
            align: "right",
            cell: (r) =>
              r.position.valuationEur == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <SensitiveValue className="tabular-nums">
                  {formatEur(r.position.valuationEur)}
                </SensitiveValue>
              ),
          },
          {
            key: "pnl",
            header: "P/L",
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
              const pctLabel =
                r.pnlPct == null
                  ? null
                  : `${r.pnlPct >= 0 ? "+" : ""}${formatPercent(r.pnlPct)}`;
              return (
                <div className={`flex flex-col items-end leading-tight ${color}`}>
                  <SensitiveValue className="tabular-nums">
                    {formatEur(r.pnlEur)}
                  </SensitiveValue>
                  {pctLabel && (
                    <span className="text-xs tabular-nums opacity-80">
                      {pctLabel}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: "graph",
            header: "Graph",
            align: "right",
            className: "w-[260px]",
            cell: (r) => (
              <div className="flex justify-end">
                <PositionSparkline
                  id={r.position.position.id}
                  data={r.sparkline}
                />
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}
