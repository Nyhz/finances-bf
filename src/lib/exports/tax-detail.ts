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
  // Money serializes at exactly 2dp (audit T9); quantities keep full precision.
  const eur = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));
  const lines: string[] = [`\uFEFF# year: ${report.year}`];
  if (report.excludedSales && report.excludedSales.count > 0) {
    lines.push(
      `# excluded by dust filter: ${report.excludedSales.count} disposals, ` +
        `proceeds ${eur(report.excludedSales.proceedsEur)} EUR, ` +
        `cost basis ${eur(report.excludedSales.costBasisEur)} EUR`,
    );
  }

  // Filas listas para transcribir a Rentanet: una por pareja venta↔compra
  // (FIFO), valores históricos sin actualizar.
  lines.push("# DECLARACION (venta <-> compra FIFO)");
  lines.push(csvRow([
    "saleTransactionId", "assetName", "isin",
    "fechaAdquisicion", "fechaTransmision", "cantidad",
    "valorAdquisicionEur", "valorTransmisionEur", "gastosTransmisionEur",
    "resultadoEur", "recompra",
  ]));
  for (const d of report.declaration ?? []) {
    lines.push(csvRow([
      d.saleTransactionId, d.assetName, d.isin,
      iso(d.acquiredAt), iso(d.soldAt), d.qty,
      eur(d.valorAdquisicionEur), eur(d.valorTransmisionEur), eur(d.gastosTransmisionEur),
      eur(d.resultadoEur), d.recompra ? "SI" : "NO",
    ]));
  }

  lines.push("# SALES");
  lines.push(csvRow([
    "transactionId", "tradedAt", "assetName", "isin", "assetClassTax",
    "quantity", "proceedsEur", "costBasisEur", "feesEur",
    "rawGainLossEur", "nonComputableLossEur", "computableGainLossEur", "valuationBasis",
  ]));
  for (const s of report.sales) {
    lines.push(csvRow([
      s.transactionId, iso(s.tradedAt), s.assetName, s.isin, s.assetClassTax,
      s.quantity, eur(s.proceedsEur), eur(s.costBasisEur), eur(s.feesEur),
      eur(s.rawGainLossEur), eur(s.nonComputableLossEur), eur(s.computableGainLossEur),
      s.valuationBasis ?? "user-input",
    ]));
  }

  lines.push("# LOTS CONSUMED");
  lines.push(csvRow(["saleTransactionId", "lotId", "acquiredAt", "qtyConsumed", "costBasisEur"]));
  for (const s of report.sales) {
    for (const l of s.consumedLots) {
      lines.push(csvRow([s.transactionId, l.lotId, iso(l.acquiredAt), l.qtyConsumed, eur(l.costBasisEur)]));
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
      d.grossNative, eur(d.grossEur), eur(d.withholdingOrigenEur), eur(d.withholdingDestinoEur), eur(d.netEur),
    ]));
  }

  lines.push("# YEAR-END BALANCES");
  lines.push(csvRow([
    "accountName", "accountCountry", "accountType", "assetName", "isin",
    "quantity", "valueEur", "valuationDate", "priceSource", "valuationStatus",
  ]));
  for (const b of report.yearEndBalances) {
    lines.push(csvRow([
      b.accountName, b.accountCountry, b.accountType, b.assetName, b.isin,
      b.quantity,
      b.valueEur != null ? eur(b.valueEur) : "UNVALUED",
      b.valuationDate,
      b.priceSource,
      b.unvalued ? "unvalued" : b.staleValuation ? "stale" : "ok",
    ]));
  }

  return lines.join("\n") + "\n";
}
