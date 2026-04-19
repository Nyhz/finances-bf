export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { buildTaxReport } from "@/src/server/tax/report";
import { computeDriftSinceSeal, getSnapshot } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { getTaxYears } from "@/src/server/taxes";
import { db } from "@/src/db/client";
import { TaxesHeader } from "@/src/components/features/taxes/TaxesHeader";

type Params = Promise<{ year: string }>;

export default async function TaxYearPage({ params }: { params: Params }) {
  const { year: yearStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(year)) notFound();

  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const blocks = aggregateBlocksFromBalances(report.yearEndBalances);
  const models = snapshot
    ? {
        m720: (snapshot.payload as { m720: unknown }).m720,
        m721: (snapshot.payload as { m721: unknown }).m721,
        d6: (snapshot.payload as { d6: unknown }).d6,
      }
    : computeInformationalModelsStatus(db, year, blocks);
  const drift = computeDriftSinceSeal(db, year);
  const years = await getTaxYears();

  return (
    <div className="flex flex-col gap-6 p-8">
      <TaxesHeader year={year} availableYears={years} sealed={snapshot != null} />
      <pre className="text-xs opacity-60 overflow-auto rounded-md border border-border p-4">
        {JSON.stringify({ year, totals: report.totals, models, drift, yearsAvailable: years }, null, 2)}
      </pre>
    </div>
  );
}
