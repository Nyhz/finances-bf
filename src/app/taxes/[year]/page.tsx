export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { buildTaxReport } from "@/src/server/tax/report";
import { computeDriftSinceSeal, getSnapshot } from "@/src/server/tax/seals";
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

  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const blocks = aggregateBlocksFromBalances(report.yearEndBalances);
  const models: InformationalModelsStatus = snapshot
    ? snapshot.payload
    : computeInformationalModelsStatus(db, year, blocks);
  const drift = computeDriftSinceSeal(db, year);
  const years = await getTaxYears();
  const interestEur = await getInterestForYear(year);

  return (
    <div className="flex flex-col gap-6 p-8">
      <TaxesHeader year={year} availableYears={years} sealed={snapshot != null} />
      {drift ? <DriftBanner drift={drift} /> : null}
      <TaxKpiRow report={report} interestEur={interestEur} />
      <GainsTable sales={report.sales} />
      <DividendsTable dividends={report.dividends} />
      <YearEndCard models={models} />
    </div>
  );
}
