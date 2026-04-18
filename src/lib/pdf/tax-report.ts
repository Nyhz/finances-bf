import { jsPDF } from "jspdf";
import type { RealizedGainsYearResult } from "@/src/server/taxes";

export type TaxReportInput = {
  year: number;
  gains: RealizedGainsYearResult;
  dividendsEur: number;
  interestEur: number;
  generatedAt?: number;
};

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function formatDate(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function buildTaxReportPdf(input: TaxReportInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Tax Report ${input.year}`, margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Generated: ${new Date(input.generatedAt ?? Date.now()).toISOString()}`,
    margin,
    y,
  );
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", margin, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const lines: Array<[string, number]> = [
    ["Realized gains", input.gains.totals.realizedGainsEur],
    ["Realized losses", input.gains.totals.realizedLossesEur],
    ["Net realized P&L", input.gains.totals.netRealizedEur],
    ["Proceeds", input.gains.totals.proceedsEur],
    ["Cost basis", input.gains.totals.costBasisEur],
    ["Fees", input.gains.totals.feesEur],
    ["Dividends", input.dividendsEur],
    ["Interest", input.interestEur],
  ];
  for (const [label, value] of lines) {
    doc.text(label, margin, y);
    doc.text(eur.format(value), 555 - margin, y, { align: "right" });
    y += 14;
  }

  y += 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Realized sales (FIFO)", margin, y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Date", margin, y);
  doc.text("Asset", margin + 70, y);
  doc.text("Qty", margin + 230, y);
  doc.text("Proceeds", margin + 290, y);
  doc.text("Cost", margin + 370, y);
  doc.text("Fees", margin + 430, y);
  doc.text("Gain", 555 - margin, y, { align: "right" });
  y += 6;
  doc.setLineWidth(0.5);
  doc.line(margin, y, 555 - margin, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  for (const sale of input.gains.sales) {
    if (y > 780) {
      doc.addPage();
      y = margin;
    }
    doc.text(formatDate(sale.sellDate), margin, y);
    doc.text((sale.assetName ?? sale.assetId).slice(0, 28), margin + 70, y);
    doc.text(sale.quantity.toFixed(4), margin + 230, y);
    doc.text(eur.format(sale.proceedsEur), margin + 290, y);
    doc.text(eur.format(sale.costBasisEur), margin + 370, y);
    doc.text(eur.format(sale.feesEur), margin + 430, y);
    doc.text(eur.format(sale.realizedGainEur), 555 - margin, y, { align: "right" });
    y += 13;
  }

  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}
