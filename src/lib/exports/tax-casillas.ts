import type { TaxReport } from "../../server/tax/report";
import { ddiTreatyRate } from "../../server/tax/countries";

type Row = { casilla: string; label: string; valueEur: number };

export function buildCasillasCsv(report: TaxReport): string {
  const rows: Row[] = [];
  rows.push({ casilla: "0326", label: "Ganancias patrimoniales (transmisión)", valueEur: report.totals.realizedGainsEur });
  rows.push({ casilla: "0340", label: "Pérdidas computables", valueEur: Math.abs(report.totals.realizedLossesComputableEur) });
  rows.push({ casilla: "0343", label: "Saldo neto ganancias/pérdidas patrimoniales", valueEur: report.totals.netComputableEur });
  rows.push({ casilla: "0027", label: "Rendimientos del capital mobiliario (dividendos gross)", valueEur: report.totals.dividendsGrossEur });
  rows.push({
    casilla: "0029",
    label: "Retenciones e ingresos a cuenta",
    valueEur: report.totals.withholdingOrigenTotalEur + report.totals.withholdingDestinoTotalEur,
  });
  const ddi = report.dividends.reduce((sum, d) => {
    const cap = d.sourceCountry ? ddiTreatyRate(d.sourceCountry) : 0.15;
    return sum + Math.min(d.withholdingOrigenEur, cap * d.grossEur);
  }, 0);
  rows.push({ casilla: "0588", label: "Deducción doble imposición internacional", valueEur: Math.round(ddi * 100) / 100 });

  const header = "casilla|etiqueta|valor_eur";
  const body = rows.map((r) => `${r.casilla}|${r.label}|${r.valueEur}`).join("\n");
  return `\uFEFF${header}\n${body}\n`;
}
