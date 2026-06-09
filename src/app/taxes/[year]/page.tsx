export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { buildTaxReport } from "@/src/server/tax/report";
import { computeDriftSinceSeal, getSnapshotState } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { getTaxYears } from "@/src/server/tax/years";
import { getInterestForYear } from "@/src/server/tax/interest";
import { db } from "@/src/db/client";
import { TaxesHeader } from "@/src/components/features/taxes/TaxesHeader";
import { DriftBanner } from "@/src/components/features/taxes/DriftBanner";
import { TaxKpiRow } from "@/src/components/features/taxes/TaxKpiRow";
import { GainsTable } from "@/src/components/features/taxes/GainsTable";
import { DividendsTable } from "@/src/components/features/taxes/DividendsTable";
import { YearEndCard } from "@/src/components/features/taxes/YearEndCard";
import type { InformationalModelsStatus } from "@/src/server/tax/m720";

type Params = Promise<{ year: string }>;

export default async function TaxYearPage({ params }: { params: Params }) {
  const { year: yearStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(year)) notFound();

  const snapshotState = getSnapshotState(db, year);
  const snapshot = snapshotState.status === "ok" ? snapshotState.snapshot : null;
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const blocks = aggregateBlocksFromBalances(report.yearEndBalances);
  const models: InformationalModelsStatus = snapshot
    ? snapshot.payload
    : computeInformationalModelsStatus(db, year, blocks);
  const drift = computeDriftSinceSeal(db, year);
  const years = await getTaxYears();
  const interestEur = await getInterestForYear(year);
  const hasUnvalued = [...models.m720.blocks, ...models.m721.blocks].some(
    (b) => b.hasUnvalued,
  );

  return (
    <div className="flex flex-col gap-6 p-8">
      <TaxesHeader
        year={year}
        availableYears={years}
        sealed={snapshot != null}
        hasUnvalued={hasUnvalued}
      />
      {snapshotState.status === "corrupt" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          The sealed snapshot for {year} is unreadable — showing LIVE numbers, which may
          differ from what was filed. Check the audit log and re-seal once resolved.
        </div>
      ) : null}
      {drift ? <DriftBanner drift={drift} /> : null}
      <TaxKpiRow report={report} interestEur={interestEur} />
      <GainsTable sales={report.sales} excludedSales={report.excludedSales} />
      <DividendsTable dividends={report.dividends} />
      <YearEndCard models={models} />
    </div>
  );
}
