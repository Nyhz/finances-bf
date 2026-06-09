import { jsPDF } from "jspdf";
import type { StatementReport } from "../../server/statement";

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const PAGE_RIGHT = 555;
const PAGE_BREAK_Y = 780;
const MARGIN = 40;

function formatQty(value: number): string {
  return value.toLocaleString("en-IE", { maximumFractionDigits: 8 });
}

function formatPct(ratio: number | null): string {
  if (ratio == null) return "—";
  const pct = ratio * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

type Cursor = { doc: jsPDF; y: number };

function ensureRoom(cur: Cursor, needed = 14): void {
  if (cur.y > PAGE_BREAK_Y - needed) {
    cur.doc.addPage();
    cur.y = MARGIN;
  }
}

function assetHeaderRow(cur: Cursor): void {
  ensureRoom(cur, 20);
  const { doc } = cur;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Asset", MARGIN, cur.y);
  doc.text("Symbol", MARGIN + 165, cur.y);
  doc.text("Qty", MARGIN + 265, cur.y, { align: "right" });
  doc.text("Unit (EUR)", MARGIN + 330, cur.y, { align: "right" });
  doc.text("Value (EUR)", MARGIN + 400, cur.y, { align: "right" });
  doc.text("Cost (EUR)", MARGIN + 465, cur.y, { align: "right" });
  doc.text("P&L", PAGE_RIGHT, cur.y, { align: "right" });
  cur.y += 5;
  doc.setLineWidth(0.5);
  doc.line(MARGIN, cur.y, PAGE_RIGHT, cur.y);
  cur.y += 11;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
}

export function buildStatementReportPdf(report: StatementReport): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cur: Cursor = { doc, y: MARGIN };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Portfolio Statement", MARGIN, cur.y);
  cur.y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date(report.generatedAt).toISOString()}`, MARGIN, cur.y);
  cur.y += 14;
  doc.text(
    `${report.totals.positionsCount} open positions across ${report.totals.accountsCount} accounts`,
    MARGIN,
    cur.y,
  );
  cur.y += 22;

  // Totals block
  const totals: Array<[string, string]> = [
    ["Net worth", eur.format(report.totals.netWorthEur)],
    ["Invested (market value)", eur.format(report.totals.investedMarketValueEur)],
    ["Cash", eur.format(report.totals.cashEur)],
    [
      "Unrealized P&L",
      `${eur.format(report.totals.unrealizedPnlEur)} (${formatPct(report.totals.unrealizedPnlPct)})`,
    ],
  ];
  for (const [label, value] of totals) {
    doc.setFont("helvetica", "normal");
    doc.text(label, MARGIN, cur.y);
    doc.setFont("helvetica", "bold");
    doc.text(value, MARGIN + 200, cur.y);
    cur.y += 14;
  }
  cur.y += 12;

  // Holdings grouped by asset type
  for (const group of report.groups) {
    ensureRoom(cur, 46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      `${group.assetType.toUpperCase()} — ${eur.format(group.marketValueEur)} (${(group.weight * 100).toFixed(1)}% of invested)`,
      MARGIN,
      cur.y,
    );
    cur.y += 14;
    assetHeaderRow(cur);

    for (const line of group.lines) {
      ensureRoom(cur);
      doc.text(line.name.slice(0, 38), MARGIN, cur.y);
      doc.text((line.symbol ?? "—").slice(0, 14), MARGIN + 165, cur.y);
      doc.text(formatQty(line.quantity), MARGIN + 265, cur.y, { align: "right" });
      doc.text(
        line.unitPriceEur != null ? eur.format(line.unitPriceEur) : "—",
        MARGIN + 330,
        cur.y,
        { align: "right" },
      );
      doc.text(
        line.marketValueEur != null ? eur.format(line.marketValueEur) : "—",
        MARGIN + 400,
        cur.y,
        { align: "right" },
      );
      doc.text(eur.format(line.costEur), MARGIN + 465, cur.y, { align: "right" });
      doc.text(formatPct(line.pnlPct), PAGE_RIGHT, cur.y, { align: "right" });
      cur.y += 12;
    }

    ensureRoom(cur, 20);
    cur.y += 2;
    doc.setLineWidth(0.5);
    doc.line(MARGIN, cur.y, PAGE_RIGHT, cur.y);
    cur.y += 11;
    doc.setFont("helvetica", "bold");
    doc.text(`Subtotal ${group.assetType}`, MARGIN, cur.y);
    doc.text(eur.format(group.marketValueEur), MARGIN + 400, cur.y, { align: "right" });
    doc.text(eur.format(group.costEur), MARGIN + 465, cur.y, { align: "right" });
    doc.text(
      `${group.pnlEur >= 0 ? "+" : ""}${eur.format(group.pnlEur)}`,
      PAGE_RIGHT,
      cur.y,
      { align: "right" },
    );
    cur.y += 22;
    doc.setFont("helvetica", "normal");
  }

  // Accounts
  ensureRoom(cur, 60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Accounts", MARGIN, cur.y);
  cur.y += 14;
  doc.setFontSize(8);
  doc.text("Account", MARGIN, cur.y);
  doc.text("Type", MARGIN + 200, cur.y);
  doc.text("Cash (EUR)", MARGIN + 360, cur.y, { align: "right" });
  doc.text("Invested (EUR)", MARGIN + 450, cur.y, { align: "right" });
  doc.text("Total (EUR)", PAGE_RIGHT, cur.y, { align: "right" });
  cur.y += 5;
  doc.setLineWidth(0.5);
  doc.line(MARGIN, cur.y, PAGE_RIGHT, cur.y);
  cur.y += 11;
  doc.setFont("helvetica", "normal");
  for (const account of report.accounts) {
    ensureRoom(cur);
    doc.text(account.name.slice(0, 44), MARGIN, cur.y);
    doc.text(account.accountType, MARGIN + 200, cur.y);
    doc.text(eur.format(account.cashEur), MARGIN + 360, cur.y, { align: "right" });
    doc.text(eur.format(account.investedEur), MARGIN + 450, cur.y, { align: "right" });
    doc.text(eur.format(account.totalEur), PAGE_RIGHT, cur.y, { align: "right" });
    cur.y += 12;
  }

  ensureRoom(cur, 30);
  cur.y += 2;
  doc.setLineWidth(0.5);
  doc.line(MARGIN, cur.y, PAGE_RIGHT, cur.y);
  cur.y += 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total net worth", MARGIN, cur.y);
  doc.text(eur.format(report.totals.netWorthEur), PAGE_RIGHT, cur.y, { align: "right" });

  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}
