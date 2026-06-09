export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/src/components/ui/Card";
import { KPICard } from "@/src/components/ui/KPICard";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { ChartCardSkeleton } from "@/src/components/features/overview/skeletons";
import { AccountsBarChart } from "@/src/components/features/statement/AccountsBarChart";
import { AllocationDonut } from "@/src/components/features/statement/AllocationDonut";
import { StatementExportMenu } from "@/src/components/features/statement/StatementExportMenu";
import { StatementValueChart } from "@/src/components/features/statement/StatementValueChart";
import { TypePnlChart } from "@/src/components/features/statement/TypePnlChart";
import { cn } from "@/src/lib/cn";
import { formatDateTime, formatEur, formatPercent } from "@/src/lib/format";
import {
  OVERVIEW_RANGES,
  getNetWorthSeries,
  type OverviewRange,
} from "@/src/server/overview";
import {
  getStatementReport,
  type StatementAccountLine,
  type StatementReport,
} from "@/src/server/statement";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function RangeTabs({ range }: { range: OverviewRange }) {
  return (
    <div className="flex items-center gap-1">
      {OVERVIEW_RANGES.map((r) => (
        <Link
          key={r}
          href={r === "ALL" ? "/statement" : `/statement?range=${r}`}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            r === range
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {r}
        </Link>
      ))}
    </div>
  );
}

function KpiRow({ report }: { report: StatementReport }) {
  const { totals } = report;
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KPICard label="Net Worth (EUR)" value={formatEur(totals.netWorthEur)} />
      <KPICard label="Invested (EUR)" value={formatEur(totals.investedMarketValueEur)} />
      <KPICard label="Cash (EUR)" value={formatEur(totals.cashEur)} />
      <KPICard
        label="Unrealized P&L (EUR)"
        value={
          <span className="flex items-baseline gap-2">
            <span>{formatEur(totals.unrealizedPnlEur)}</span>
            {totals.unrealizedPnlPct != null && (
              <span
                className={`text-sm font-medium tabular-nums ${
                  totals.unrealizedPnlEur > 0
                    ? "text-success"
                    : totals.unrealizedPnlEur < 0
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {`${totals.unrealizedPnlPct >= 0 ? "+" : ""}${formatPercent(
                  totals.unrealizedPnlPct,
                )}`}
              </span>
            )}
          </span>
        }
      />
    </section>
  );
}

async function ValueChartCard({ range }: { range: OverviewRange }) {
  const series = await getNetWorthSeries({ range, accountIds: [] });
  return (
    <Card title="Portfolio value" action={<RangeTabs range={range} />}>
      {series.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No valuation history"
          description="Daily valuations will appear once prices have been synced."
        />
      ) : (
        <StatementValueChart data={series} />
      )}
    </Card>
  );
}

function AccountsTable({ accounts }: { accounts: StatementAccountLine[] }) {
  return (
    <DataTable<StatementAccountLine>
      rows={accounts}
      getRowKey={(a) => a.accountId}
      columns={[
        {
          key: "name",
          header: "Account",
          cell: (a) => (
            <div className="flex flex-col">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs capitalize text-muted-foreground">
                {a.accountType} · {a.currency}
              </span>
            </div>
          ),
        },
        {
          key: "cash",
          header: "Cash",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.cashEur)}</SensitiveValue>
          ),
        },
        {
          key: "invested",
          header: "Invested",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.investedEur)}</SensitiveValue>
          ),
        },
        {
          key: "total",
          header: "Total",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm font-medium">
              {formatEur(a.totalEur)}
            </SensitiveValue>
          ),
        },
      ]}
    />
  );
}

export default async function StatementPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const report = await getStatementReport();
  const hasPositions = report.totals.positionsCount > 0;

  const slices = report.groups
    .filter((g) => g.marketValueEur > 0)
    .map((g) => ({
      assetType: g.assetType,
      valueEur: g.marketValueEur,
      weight: g.weight,
    }));
  const pnlRows = report.groups.map((g) => ({
    assetType: g.assetType,
    pnlEur: g.pnlEur,
  }));
  const accountBars = report.accounts
    .filter((a) => a.totalEur !== 0)
    .map((a) => ({ name: a.name, cashEur: a.cashEur, investedEur: a.investedEur }));

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Statement</h1>
          <p className="text-sm text-muted-foreground">
            Full portfolio statement as of {formatDateTime(report.generatedAt)} — every
            account, every asset, valued in EUR.
          </p>
        </div>
        <StatementExportMenu />
      </header>

      <KpiRow report={report} />

      <Suspense
        key={`value:${range}`}
        fallback={<ChartCardSkeleton title="Portfolio value" />}
      >
        <ValueChartCard range={range} />
      </Suspense>

      {hasPositions ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <Card title="Allocation by type">
            {slices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="No valued positions"
                description="Allocation appears once positions have a synced price."
              />
            ) : (
              <AllocationDonut
                slices={slices}
                totalEur={report.totals.investedMarketValueEur}
              />
            )}
          </Card>
          <Card title="Value by account">
            {accountBars.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="No account balances"
                description="Account balances appear once accounts have activity."
              />
            ) : (
              <AccountsBarChart rows={accountBars} />
            )}
          </Card>
          <Card title="Unrealized P&L by type">
            {pnlRows.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="No P&L yet"
                description="P&L appears once positions have a synced price."
              />
            ) : (
              <TypePnlChart rows={pnlRows} />
            )}
          </Card>
        </section>
      ) : (
        <StatesBlock
          mode="empty"
          title="No open positions"
          description="Import transactions or add trades to build your statement."
        />
      )}

      <Card title="Accounts">
        {report.accounts.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="No accounts"
            description="Create an account to start tracking your portfolio."
          />
        ) : (
          <AccountsTable accounts={report.accounts} />
        )}
      </Card>
    </div>
  );
}
