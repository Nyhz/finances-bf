import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { getInterestForYear } from "@/src/server/tax/interest";
import { buildPrevision } from "@/src/server/tax/prevision";
import { buildCasillasCsv } from "@/src/lib/exports/tax-casillas";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearStr = url.searchParams.get("year");
  const year = yearStr ? Number.parseInt(yearStr, 10) : NaN;
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const interestEur = await getInterestForYear(year, db);
  // DDI capped to cuota íntegra — must match the PDF (audit F3).
  const { cuota } = buildPrevision(report, interestEur);
  const csv = buildCasillasCsv(report, cuota.ddiCreditEur);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="taxes-${year}-casillas.csv"`,
    },
  });
}
