import {
  computeDividendAndInterestForYear,
  computeRealizedGainsForYear,
} from "@/src/server/taxes";
import { buildTaxReportPdf } from "@/src/lib/pdf/tax-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearRaw = url.searchParams.get("year");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1970 || year > 3000) {
    return Response.json({ error: "invalid year" }, { status: 400 });
  }

  const [gains, dividends] = await Promise.all([
    computeRealizedGainsForYear(year),
    computeDividendAndInterestForYear(year),
  ]);

  const bytes = buildTaxReportPdf({
    year,
    gains,
    dividendsEur: dividends.dividendsEur,
    interestEur: dividends.interestEur,
  });

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="tax-report-${year}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
