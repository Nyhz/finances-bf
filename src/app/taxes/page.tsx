export const dynamic = "force-dynamic";

import { Card } from "@/src/components/ui/Card";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { YearSelect } from "@/src/components/features/taxes/YearSelect";
import { getRealizedGains, getTaxYears, type RealizedGain } from "@/src/server/taxes";
import { formatEur, formatDate } from "@/src/lib/format";

type SearchParams = Promise<{ year?: string }>;

export default async function TaxesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { year: yearParam } = await searchParams;
  const years = await getTaxYears();

  if (years.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Taxes</h1>
          <p className="text-sm text-muted-foreground">
            Yearly realized gains and dividends.
          </p>
        </header>
        <StatesBlock
          mode="empty"
          title="No taxable events yet"
          description="Record trades to see realized gains and dividends by year."
        />
      </div>
    );
  }

  const parsed = yearParam ? Number.parseInt(yearParam, 10) : Number.NaN;
  const year = Number.isFinite(parsed) && years.includes(parsed) ? parsed : years[0];
  const result = await getRealizedGains(year);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Taxes</h1>
          <p className="text-sm text-muted-foreground">
            Realized gains and dividends for {year}.
          </p>
        </div>
        <YearSelect years={years} value={year} />
      </header>

      <Card title={`Realized gains — ${year}`}>
        <DataTable<RealizedGain>
          rows={result.gains}
          getRowKey={(r, i) => `${r.assetId}-${r.closedAt}-${i}`}
          emptyState="No realized gains for the selected year."
          columns={[
            {
              key: "closedAt",
              header: "Closed",
              cell: (r) => formatDate(r.closedAt),
            },
            { key: "asset", header: "Asset", cell: (r) => r.assetId },
            {
              key: "qty",
              header: "Qty",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.quantity.toFixed(4)}</span>
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
              key: "gain",
              header: "Gain (EUR)",
              align: "right",
              cell: (r) => (
                <SensitiveValue>{formatEur(r.gainEur)}</SensitiveValue>
              ),
            },
          ]}
          footer={
            <>
              <span>{result.gains.length} lots</span>
              <span className="flex items-center gap-2">
                <span>Total realized:</span>
                <SensitiveValue className="font-medium text-foreground">
                  {formatEur(result.totalRealizedEur)}
                </SensitiveValue>
              </span>
            </>
          }
        />
      </Card>
    </div>
  );
}
