export const dynamic = "force-dynamic";

import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { KPICard } from "@/src/components/ui/KPICard";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { YearSelect } from "@/src/components/features/taxes/YearSelect";
import {
  computeDividendAndInterestForYear,
  computeRealizedGainsForYear,
  getTaxYears,
  type RealizedSale,
} from "@/src/server/taxes";
import { formatEur, formatDate } from "@/src/lib/format";

type SearchParams = Promise<{ year?: string }>;

const DEFAULT_YEAR = 2026;

export default async function TaxesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { year: yearParam } = await searchParams;
  const years = await getTaxYears();

  const parsed = yearParam ? Number.parseInt(yearParam, 10) : Number.NaN;
  const year = Number.isFinite(parsed)
    ? parsed
    : years.includes(DEFAULT_YEAR)
      ? DEFAULT_YEAR
      : (years[0] ?? DEFAULT_YEAR);

  const yearOptions = years.includes(year) ? years : [year, ...years];

  const [realized, cash] = await Promise.all([
    computeRealizedGainsForYear(year),
    computeDividendAndInterestForYear(year),
  ]);

  const hasAny =
    realized.sales.length > 0 ||
    cash.dividendsEur !== 0 ||
    cash.interestEur !== 0;

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Taxes</h1>
          <p className="text-sm text-muted-foreground">
            Realized gains and dividends for {year}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            href={`/api/exports/tax-report?year=${year}`}
          >
            Export PDF
          </a>
          <YearSelect years={yearOptions} value={year} />
        </div>
      </header>

      {!hasAny ? (
        <StatesBlock
          mode="empty"
          title="No taxable events for this year"
          description="Record trades, dividends, or interest to see a yearly report."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KPICard
              label="Realized Gains (EUR)"
              value={formatEur(realized.totals.realizedGainsEur)}
            />
            <KPICard
              label="Realized Losses (EUR)"
              value={formatEur(realized.totals.realizedLossesEur)}
            />
            <KPICard
              label="Net Realized (EUR)"
              value={formatEur(realized.totals.netRealizedEur)}
            />
            <KPICard
              label="Dividends (EUR)"
              value={formatEur(cash.dividendsEur)}
            />
            <KPICard
              label="Interest (EUR)"
              value={formatEur(cash.interestEur)}
            />
          </section>

          <Card title={`Realized sales — ${year}`}>
            <DataTable<RealizedSale>
              rows={realized.sales}
              getRowKey={(r) => r.saleId}
              emptyState="No realized sales for the selected year."
              columns={[
                {
                  key: "sellDate",
                  header: "Sold",
                  cell: (r) => formatDate(r.sellDate),
                },
                {
                  key: "account",
                  header: "Account",
                  cell: (r) => r.accountName ?? r.accountId,
                },
                {
                  key: "asset",
                  header: "Asset",
                  cell: (r) => r.assetName ?? r.assetId,
                },
                {
                  key: "qty",
                  header: "Qty",
                  align: "right",
                  cell: (r) => (
                    <span className="tabular-nums">
                      {r.quantity.toFixed(4)}
                    </span>
                  ),
                },
                {
                  key: "proceeds",
                  header: "Proceeds (EUR)",
                  align: "right",
                  cell: (r) => (
                    <SensitiveValue>{formatEur(r.proceedsEur)}</SensitiveValue>
                  ),
                },
                {
                  key: "cost",
                  header: "Cost Basis (EUR)",
                  align: "right",
                  cell: (r) => (
                    <SensitiveValue>{formatEur(r.costBasisEur)}</SensitiveValue>
                  ),
                },
                {
                  key: "fees",
                  header: "Fees (EUR)",
                  align: "right",
                  cell: (r) => (
                    <SensitiveValue>{formatEur(r.feesEur)}</SensitiveValue>
                  ),
                },
                {
                  key: "gain",
                  header: "Gain (EUR)",
                  align: "right",
                  cell: (r) => (
                    <SensitiveValue>
                      {formatEur(r.realizedGainEur)}
                    </SensitiveValue>
                  ),
                },
              ]}
              footer={
                <>
                  <span>{realized.sales.length} sales</span>
                  <span className="flex items-center gap-2">
                    <span>Net realized:</span>
                    <SensitiveValue className="font-medium text-foreground">
                      {formatEur(realized.totals.netRealizedEur)}
                    </SensitiveValue>
                  </span>
                </>
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}
