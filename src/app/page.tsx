export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { Card } from "@/src/components/ui/Card";
import { KPICard } from "@/src/components/ui/KPICard";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AllocationDonut } from "@/src/components/features/overview/AllocationDonut";
import { NetWorthChart } from "@/src/components/features/overview/NetWorthChart";
import { OverviewFilters } from "@/src/components/features/overview/OverviewFilters";
import { TopPositionsTable } from "@/src/components/features/overview/TopPositionsTable";
import { listAccounts } from "@/src/server/accounts";
import {
  OVERVIEW_RANGES,
  getAllocationByClass,
  getNetWorthSeries,
  getOverviewKpis,
  getTopPositions,
  type OverviewRange,
} from "@/src/server/overview";
import { formatEur } from "@/src/lib/format";

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function parseAccountId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const accountIdParam = parseAccountId(params.accountId);

  const accountsList = await listAccounts();
  const accountId = accountIdParam && accountsList.some((a) => a.id === accountIdParam)
    ? accountIdParam
    : null;
  const filters = { range, accountId };

  const [kpis, series, topPositions, allocation] = await Promise.all([
    getOverviewKpis(filters),
    getNetWorthSeries(filters),
    getTopPositions(filters, 10),
    getAllocationByClass(filters),
  ]);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Snapshot of your portfolio across every account.
          </p>
        </div>
        <Suspense fallback={null}>
          <OverviewFilters
            accounts={accountsList.map((a) => ({ id: a.id, name: a.name }))}
            range={range}
            accountId={accountId}
          />
        </Suspense>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KPICard label="Net Worth (EUR)" value={formatEur(kpis.totalNetWorthEur)} />
        <KPICard label="Cash (EUR)" value={formatEur(kpis.cashEur)} />
        <KPICard label="Invested (EUR)" value={formatEur(kpis.investedEur)} />
        <KPICard
          label="Unrealized P&L (EUR)"
          value={formatEur(kpis.unrealizedPnlEur)}
        />
        <KPICard
          label="Realized P&L YTD (EUR)"
          value={
            kpis.realizedPnlYtdEur == null
              ? "—"
              : formatEur(kpis.realizedPnlYtdEur)
          }
        />
      </section>

      <Card title="Net worth">
        {series.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="No balance history"
            description="Daily balances will appear once accounts have activity."
          />
        ) : (
          <NetWorthChart data={series} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopPositionsTable rows={topPositions} />
        <Card title="Allocation">
          {allocation.length === 0 ? (
            <StatesBlock
              mode="empty"
              title="No allocation"
              description="Allocation appears once positions have a market value."
            />
          ) : (
            <AllocationDonut data={allocation} />
          )}
        </Card>
      </div>
    </div>
  );
}
