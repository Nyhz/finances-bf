import { jsPDF } from "jspdf";
import type { TaxReport } from "../../server/tax/report";
import type { InformationalModelsStatus } from "../../server/tax/m720";

export type TaxPdfInput = {
  year: number;
  report: TaxReport;
  models: InformationalModelsStatus;
  sealedAt: number | null;
};

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function fmt(n: number): string { return eur.format(n); }

export function buildTaxReportPdf(input: TaxPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 40;
  const L = 40;

  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(`IRPF — ${input.year}`, L, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(input.sealedAt ? `Sealed ${new Date(input.sealedAt).toISOString().slice(0, 10)}` : "Unsealed (live)", L, y); y += 18;

  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Totales", L, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const t = input.report.totals;
  const rows: [string, string][] = [
    ["Realized gains", fmt(t.realizedGainsEur)],
    ["Realized losses (computable)", fmt(t.realizedLossesComputableEur)],
    ["Non-computable losses (art. 33.5)", fmt(t.nonComputableLossesEur)],
    ["Net computable", fmt(t.netComputableEur)],
    ["Dividends gross", fmt(t.dividendsGrossEur)],
    ["Retención origen total", fmt(t.withholdingOrigenTotalEur)],
  ];
  for (const [label, val] of rows) { doc.text(label, L, y); doc.text(val, 500, y, { align: "right" }); y += 14; }
  y += 10;

  doc.setFont("helvetica", "bold"); doc.text("Ganancias patrimoniales", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const s of input.report.sales) {
    if (y > 780) { doc.addPage(); y = 40; }
    doc.text(`${new Date(s.tradedAt).toISOString().slice(0, 10)}  ${s.assetName ?? s.assetId}  qty ${s.quantity}`, L, y); y += 12;
    doc.text(`  gross ${fmt(s.rawGainLossEur)}  non-comp ${fmt(s.nonComputableLossEur)}  computable ${fmt(s.computableGainLossEur)}`, L, y); y += 14;
  }

  doc.setFont("helvetica", "bold"); doc.text("Dividendos", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const d of input.report.dividends) {
    if (y > 780) { doc.addPage(); y = 40; }
    doc.text(`${new Date(d.tradedAt).toISOString().slice(0, 10)}  ${d.assetName ?? d.assetId}  ${d.sourceCountry ?? "—"}  gross ${fmt(d.grossEur)}  WHT ${fmt(d.withholdingOrigenEur)}`, L, y); y += 12;
  }

  doc.setFont("helvetica", "bold"); doc.text("Modelos informativos", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  const renderBlocks = (label: string, blocks: InformationalModelsStatus["m720"]["blocks"]) => {
    doc.text(label, L, y); y += 12;
    for (const b of blocks) { doc.text(`  ${b.country}  ${b.type}  ${b.status}  ${fmt(b.valueEur)}`, L, y); y += 12; }
  };
  renderBlocks("720", input.models.m720.blocks);
  renderBlocks("721", input.models.m721.blocks);
  renderBlocks("D-6", input.models.d6.blocks);

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
