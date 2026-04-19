import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus, type InformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { buildTaxReportPdf } from "@/src/lib/pdf/tax-report";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const models: InformationalModelsStatus = snapshot
    ? (snapshot.payload as unknown as InformationalModelsStatus)
    : computeInformationalModelsStatus(db, year, aggregateBlocksFromBalances(report.yearEndBalances));
  const pdf = buildTaxReportPdf({
    year,
    report,
    models,
    sealedAt: snapshot?.sealedAt ?? null,
  });
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="taxes-${year}.pdf"`,
    },
  });
}
