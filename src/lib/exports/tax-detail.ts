import type { TaxReport } from "../../server/tax/report";

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      if (f == null) return "";
      const s = String(f);
      if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

export function buildDetailCsv(report: TaxReport): string {
  const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const lines: string[] = [`\uFEFF# year: ${report.year}`];

  lines.push("# SALES");
  lines.push(csvRow([
    "transactionId", "tradedAt", "assetName", "isin", "assetClassTax",
    "quantity", "proceedsEur", "costBasisEur", "feesEur",
    "rawGainLossEur", "nonComputableLossEur", "computableGainLossEur",
  ]));
  for (const s of report.sales) {
    lines.push(csvRow([
      s.transactionId, iso(s.tradedAt), s.assetName, s.isin, s.assetClassTax,
      s.quantity, s.proceedsEur, s.costBasisEur, s.feesEur,
      s.rawGainLossEur, s.nonComputableLossEur, s.computableGainLossEur,
    ]));
  }

  lines.push("# LOTS CONSUMED");
  lines.push(csvRow(["saleTransactionId", "lotId", "acquiredAt", "qtyConsumed", "costBasisEur"]));
  for (const s of report.sales) {
    for (const l of s.consumedLots) {
      lines.push(csvRow([s.transactionId, l.lotId, iso(l.acquiredAt), l.qtyConsumed, l.costBasisEur]));
    }
  }

  lines.push("# DIVIDENDS");
  lines.push(csvRow([
    "transactionId", "tradedAt", "assetName", "isin", "sourceCountry",
    "grossNative", "grossEur", "withholdingOrigenEur", "withholdingDestinoEur", "netEur",
  ]));
  for (const d of report.dividends) {
    lines.push(csvRow([
      d.transactionId, iso(d.tradedAt), d.assetName, d.isin, d.sourceCountry,
      d.grossNative, d.grossEur, d.withholdingOrigenEur, d.withholdingDestinoEur, d.netEur,
    ]));
  }

  lines.push("# YEAR-END BALANCES");
  lines.push(csvRow(["accountName", "accountCountry", "accountType", "assetName", "isin", "quantity", "valueEur"]));
  for (const b of report.yearEndBalances) {
    lines.push(csvRow([b.accountName, b.accountCountry, b.accountType, b.assetName, b.isin, b.quantity, b.valueEur]));
  }

  return lines.join("\n") + "\n";
}
