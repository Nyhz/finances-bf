export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { Card } from "@/src/components/ui/Card";
import { KPICard } from "@/src/components/ui/KPICard";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { NetWorthChart } from "@/src/components/features/overview/NetWorthChart";
import { OverviewFilters } from "@/src/components/features/overview/OverviewFilters";
import { TopPositionsTable } from "@/src/components/features/overview/TopPositionsTable";
import {
  ChartCardSkeleton,
  KpiRowSkeleton,
  TableCardSkeleton,
} from "@/src/components/features/overview/skeletons";
import { listAccounts } from "@/src/server/accounts";
import {
  OVERVIEW_RANGES,
  getNetWorthSeries,
  getOverviewKpis,
  getTopPositions,
  type OverviewRange,
} from "@/src/server/overview";
import { formatEur, formatPercent } from "@/src/lib/format";

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function parseAccountIds(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

type Filters = { range: OverviewRange; accountIds: string[] };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function KpiRow({ filters }: { filters: Filters }) {
  const kpis = await getOverviewKpis(filters);
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KPICard label="Net Worth (EUR)" value={formatEur(kpis.totalNetWorthEur)} />
      <KPICard label="Cash (EUR)" value={formatEur(kpis.cashEur)} />
      <KPICard label="Invested (EUR)" value={formatEur(kpis.investedEur)} />
      <KPICard
        label="Unrealized P&L (EUR)"
        value={
          <span className="flex items-baseline gap-2">
            <span>{formatEur(kpis.unrealizedPnlEur)}</span>
            {kpis.unrealizedPnlPct != null && (
              <span
                className={`text-sm font-medium tabular-nums ${
                  kpis.unrealizedPnlEur > 0
                    ? "text-success"
                    : kpis.unrealizedPnlEur < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {`${kpis.unrealizedPnlPct >= 0 ? "+" : ""}${formatPercent(
                  kpis.unrealizedPnlPct,
                )}`}
              </span>
            )}
          </span>
        }
      />
    </section>
  );
}

async function NetWorthCard({ filters }: { filters: Filters }) {
  const series = await getNetWorthSeries(filters);
  return (
    <Card title="Portfolio evolution">
      {series.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No valuation history"
          description="Daily valuations will appear once prices have been synced."
        />
      ) : (
        <NetWorthChart data={series} />
      )}
    </Card>
  );
}

async function TopPositionsCard({ filters }: { filters: Filters }) {
  const rows = await getTopPositions(filters, 10);
  return <TopPositionsTable rows={rows} />;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const rawAccountIds = parseAccountIds(params.accounts);

  const accountsList = await listAccounts();
  const validIds = new Set(accountsList.map((a) => a.id));
  const accountIds = rawAccountIds.filter((id) => validIds.has(id));
  const filters: Filters = { range, accountIds };
  const suspenseKey = `${range}:${accountIds.length === 0 ? "all" : accountIds.join(",")}`;

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
            accountIds={accountIds}
          />
        </Suspense>
      </header>

      <Suspense key={`kpi:${suspenseKey}`} fallback={<KpiRowSkeleton />}>
        <KpiRow filters={filters} />
      </Suspense>

      <Suspense
        key={`net:${suspenseKey}`}
        fallback={<ChartCardSkeleton title="Net worth" />}
      >
        <NetWorthCard filters={filters} />
      </Suspense>

      <Suspense
        key={`top:${suspenseKey}`}
        fallback={<TableCardSkeleton title="Top positions" />}
      >
        <TopPositionsCard filters={filters} />
      </Suspense>
    </div>
  );
}
