import { jsPDF } from "jspdf";
import { accountTypeLabel, ledgerLabel } from "../labels";
import { fmtDateIso, fmtEur } from "./_kit";

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

export function buildAccountStatementPdf(input: StatementInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Extracto de cuenta", margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Cuenta: ${input.account.name} (${accountTypeLabel(input.account.accountType)})`,
    margin,
    y,
  );
  y += 14;
  doc.text(
    `Periodo: ${fmtDateIso(input.from)} — ${fmtDateIso(input.to)}`,
    margin,
    y,
  );
  y += 14;
  doc.text(
    `Saldo de efectivo actual: ${fmtEur(input.account.currentCashBalanceEur)}`,
    margin,
    y,
  );
  y += 14;
  doc.text(
    `Generado: ${new Date(input.generatedAt ?? Date.now()).toISOString()}`,
    margin,
    y,
  );
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.text("Fecha", margin, y);
  doc.text("Tipo", margin + 90, y);
  doc.text("Descripción", margin + 180, y);
  doc.text("Importe (EUR)", 555 - margin, y, { align: "right" });
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
    doc.text(fmtDateIso(row.occurredAt), margin, y);
    doc.text(ledgerLabel(row.label), margin + 90, y);
    const desc = (row.description ?? "").slice(0, 60);
    doc.text(desc, margin + 180, y);
    doc.text(fmtEur(row.amountEur), 555 - margin, y, { align: "right" });
    total += row.amountEur;
    y += 14;
  }

  y += 8;
  doc.setLineWidth(0.5);
  doc.line(margin, y, 555 - margin, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.text("Movimiento neto", margin + 180, y);
  doc.text(fmtEur(total), 555 - margin, y, { align: "right" });

  const buffer = doc.output("arraybuffer");
  return new Uint8Array(buffer);
}
