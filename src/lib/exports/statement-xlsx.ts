import ExcelJS from "exceljs";
import type { StatementReport } from "../../server/statement";

const EUR_FMT = '#,##0.00 "€"';
const PCT_FMT = "0.00%";
const QTY_FMT = "#,##0.########";

function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
}

export async function buildStatementXlsx(report: StatementReport): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Finances Panel";
  wb.created = new Date(report.generatedAt);

  // --- Summary -------------------------------------------------------------
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "", key: "label", width: 36 },
    { header: "", key: "value", width: 20 },
  ];
  summary.addRow(["Portfolio Statement", ""]).font = { bold: true, size: 14 };
  summary.addRow(["Generated at", new Date(report.generatedAt).toISOString()]);
  summary.addRow([]);
  const totalsRows: Array<[string, number | null, string | null]> = [
    ["Net worth (EUR)", report.totals.netWorthEur, EUR_FMT],
    ["Cash (EUR)", report.totals.cashEur, EUR_FMT],
    ["Invested — market value (EUR)", report.totals.investedMarketValueEur, EUR_FMT],
    ["Invested — cost (EUR)", report.totals.investedCostEur, EUR_FMT],
    ["Unrealized P&L (EUR)", report.totals.unrealizedPnlEur, EUR_FMT],
    ["Unrealized P&L (%)", report.totals.unrealizedPnlPct, PCT_FMT],
    ["Open positions", report.totals.positionsCount, null],
    ["Accounts", report.totals.accountsCount, null],
  ];
  for (const [label, value, fmt] of totalsRows) {
    const row = summary.addRow([label, value ?? ""]);
    if (fmt) row.getCell(2).numFmt = fmt;
  }
  summary.addRow([]);
  styleHeaderRow(summary.addRow(["Allocation by asset type", ""]));
  styleHeaderRow(summary.addRow(["Type", "Market value (EUR)", "Cost (EUR)", "P&L (EUR)", "Weight"]));
  for (const group of report.groups) {
    const row = summary.addRow([
      group.assetType,
      group.marketValueEur,
      group.costEur,
      group.pnlEur,
      group.weight,
    ]);
    row.getCell(2).numFmt = EUR_FMT;
    row.getCell(3).numFmt = EUR_FMT;
    row.getCell(4).numFmt = EUR_FMT;
    row.getCell(5).numFmt = PCT_FMT;
  }

  // --- Assets ----------------------------------------------------------------
  const assetsSheet = wb.addWorksheet("Assets");
  assetsSheet.columns = [
    { header: "Type", key: "type", width: 14 },
    { header: "Name", key: "name", width: 40 },
    { header: "Symbol", key: "symbol", width: 12 },
    { header: "ISIN", key: "isin", width: 16 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Unit price (EUR)", key: "unitPriceEur", width: 16 },
    { header: "Market value (EUR)", key: "marketValueEur", width: 18 },
    { header: "Cost (EUR)", key: "costEur", width: 14 },
    { header: "P&L (EUR)", key: "pnlEur", width: 14 },
    { header: "P&L %", key: "pnlPct", width: 10 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Valuation date", key: "valuationDate", width: 14 },
  ];
  styleHeaderRow(assetsSheet.getRow(1));
  for (const group of report.groups) {
    for (const line of group.lines) {
      const row = assetsSheet.addRow({
        type: line.assetType,
        name: line.name,
        symbol: line.symbol ?? "",
        isin: line.isin ?? "",
        currency: line.currency,
        quantity: line.quantity,
        unitPriceEur: line.unitPriceEur ?? "",
        marketValueEur: line.marketValueEur ?? "",
        costEur: line.costEur,
        pnlEur: line.pnlEur ?? "",
        pnlPct: line.pnlPct ?? "",
        weight: line.weight ?? "",
        valuationDate: line.valuationDate ?? "",
      });
      row.getCell("quantity").numFmt = QTY_FMT;
      row.getCell("unitPriceEur").numFmt = EUR_FMT;
      row.getCell("marketValueEur").numFmt = EUR_FMT;
      row.getCell("costEur").numFmt = EUR_FMT;
      row.getCell("pnlEur").numFmt = EUR_FMT;
      row.getCell("pnlPct").numFmt = PCT_FMT;
      row.getCell("weight").numFmt = PCT_FMT;
    }
  }
  const assetsTotal = assetsSheet.addRow({
    name: "TOTAL",
    marketValueEur: report.totals.investedMarketValueEur,
    costEur: report.totals.investedCostEur,
    pnlEur: report.totals.unrealizedPnlEur,
  });
  assetsTotal.font = { bold: true };
  assetsTotal.getCell("marketValueEur").numFmt = EUR_FMT;
  assetsTotal.getCell("costEur").numFmt = EUR_FMT;
  assetsTotal.getCell("pnlEur").numFmt = EUR_FMT;

  // --- Accounts ----------------------------------------------------------------
  const accountsSheet = wb.addWorksheet("Accounts");
  accountsSheet.columns = [
    { header: "Account", key: "name", width: 30 },
    { header: "Type", key: "accountType", width: 14 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Cash (EUR)", key: "cashEur", width: 14 },
    { header: "Invested (EUR)", key: "investedEur", width: 16 },
    { header: "Total (EUR)", key: "totalEur", width: 14 },
  ];
  styleHeaderRow(accountsSheet.getRow(1));
  for (const account of report.accounts) {
    const row = accountsSheet.addRow({
      name: account.name,
      accountType: account.accountType,
      currency: account.currency,
      cashEur: account.cashEur,
      investedEur: account.investedEur,
      totalEur: account.totalEur,
    });
    row.getCell("cashEur").numFmt = EUR_FMT;
    row.getCell("investedEur").numFmt = EUR_FMT;
    row.getCell("totalEur").numFmt = EUR_FMT;
  }
  const accountsTotal = accountsSheet.addRow({
    name: "TOTAL",
    cashEur: report.totals.cashEur,
    investedEur: report.totals.investedMarketValueEur,
    totalEur: report.totals.netWorthEur,
  });
  accountsTotal.font = { bold: true };
  accountsTotal.getCell("cashEur").numFmt = EUR_FMT;
  accountsTotal.getCell("investedEur").numFmt = EUR_FMT;
  accountsTotal.getCell("totalEur").numFmt = EUR_FMT;

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
