export const dynamic = "force-dynamic";

import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { KPICard } from "@/src/components/ui/KPICard";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { PerformanceChart } from "@/src/components/features/overview/PerformanceChart";
import { getOverviewKpis, getPerformanceSeries } from "@/src/server/overview";
import { listRecentTransactions } from "@/src/server/transactions";
import { formatEur, formatDateTime } from "@/src/lib/format";
import type { AssetTransaction } from "@/src/db/schema";

export default async function OverviewPage() {
  const [kpis, series, recent] = await Promise.all([
    getOverviewKpis(),
    getPerformanceSeries(),
    listRecentTransactions(10),
  ]);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Snapshot of your portfolio across every account.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Net Worth (EUR)" value={formatEur(kpis.totalNetWorthEur)} />
        <KPICard label="Cash (EUR)" value={formatEur(kpis.cashEur)} />
        <KPICard label="Invested (EUR)" value={formatEur(kpis.investedEur)} />
        <KPICard label="Unrealized P&L (EUR)" value={formatEur(kpis.unrealizedPnlEur)} />
      </section>

      <Card title="Performance">
        {series.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="No performance data"
            description="Performance series not yet computed."
          />
        ) : (
          <PerformanceChart data={series} />
        )}
      </Card>

      <Card title="Recent transactions">
        <DataTable<AssetTransaction>
          rows={recent}
          getRowKey={(r) => r.id}
          emptyState="No transactions yet."
          columns={[
            {
              key: "tradedAt",
              header: "Date",
              cell: (r) => formatDateTime(r.tradedAt),
            },
            { key: "type", header: "Type", cell: (r) => r.transactionType },
            {
              key: "qty",
              header: "Qty",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.quantity.toFixed(4)}</span>
              ),
            },
            {
              key: "totalEur",
              header: "Total (EUR)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>{formatEur(r.tradeGrossAmountEur)}</SensitiveValue>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
