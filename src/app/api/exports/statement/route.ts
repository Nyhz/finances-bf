import { NextResponse } from "next/server";
import { getStatementReport } from "@/src/server/statement";
import { buildStatementCsv } from "@/src/lib/exports/statement-csv";
import { buildStatementXlsx } from "@/src/lib/exports/statement-xlsx";
import { buildStatementReportPdf } from "@/src/lib/pdf/statement-report";

const FORMATS = new Set(["pdf", "xlsx", "csv"]);

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "pdf";
  if (!FORMATS.has(format)) {
    return new NextResponse("format must be pdf, xlsx or csv", { status: 400 });
  }

  const report = await getStatementReport();
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);

  if (format === "csv") {
    return new NextResponse(buildStatementCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="statement-${stamp}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const bytes = await buildStatementXlsx(report);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="statement-${stamp}.xlsx"`,
      },
    });
  }

  const pdf = buildStatementReportPdf(report);
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="statement-${stamp}.pdf"`,
    },
  });
}
