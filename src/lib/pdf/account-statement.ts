import { jsPDF } from "jspdf";

export type StatementLedgerRow = {
  occurredAt: number;
  label: string;
  amountEur: number;
  description: string | null;
};

export type StatementInput = {
  account: {
    id: string;
    name: string;
    accountType: string;
    currency: string;
    currentCashBalanceEur: number;
  };
  from: number;
  to: number;
  rows: StatementLedgerRow[];
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

export function buildAccountStatementPdf(input: StatementInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Account Statement", margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Account: ${input.account.name} (${input.account.accountType})`, margin, y);
  y += 14;
  doc.text(
    `Range: ${formatDate(input.from)} — ${formatDate(input.to)}`,
    margin,
    y,
  );
  y += 14;
  doc.text(
    `Current cash balance: ${eur.format(input.account.currentCashBalanceEur)}`,
    margin,
    y,
  );
  y += 14;
  doc.text(
    `Generated: ${new Date(input.generatedAt ?? Date.now()).toISOString()}`,
    margin,
    y,
  );
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.text("Date", margin, y);
  doc.text("Type", margin + 90, y);
  doc.text("Description", margin + 180, y);
  doc.text("Amount (EUR)", 555 - margin, y, { align: "right" });
  y += 6;
  doc.setLineWidth(0.5);
  doc.line(margin, y, 555 - margin, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  let total = 0;
  for (const row of input.rows) {
    if (y > 780) {
      doc.addPage();
      y = margin;
    }
    doc.text(formatDate(row.occurredAt), margin, y);
    doc.text(row.label, margin + 90, y);
    const desc = (row.description ?? "").slice(0, 60);
    doc.text(desc, margin + 180, y);
    doc.text(eur.format(row.amountEur), 555 - margin, y, { align: "right" });
    total += row.amountEur;
    y += 14;
  }

  y += 8;
  doc.setLineWidth(0.5);
  doc.line(margin, y, 555 - margin, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.text("Net movement", margin + 180, y);
  doc.text(eur.format(total), 555 - margin, y, { align: "right" });

  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}
