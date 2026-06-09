import { jsPDF } from "jspdf";
import type { DividendReportRow, SaleReportRow, TaxReport } from "../../server/tax/report";
import type { InformationalModelsStatus } from "../../server/tax/m720";
import { estimateSavingsCuota } from "../../server/tax/cuota";

export type TaxPdfInput = {
  year: number;
  report: TaxReport;
  models: InformationalModelsStatus;
  sealedAt: number | null;
  /** Intereses de cuentas remuneradas del ejercicio (RCM), informativo. */
  interestEur: number;
};

const PAGE_BOTTOM = 800;
const L = 40;
const R = 555;

function fmt(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

type AssetSalesGroup = {
  label: string;
  isin: string | null;
  ops: number;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  feesEur: number;
  rawGainLossEur: number;
  nonComputableLossEur: number;
  computableGainLossEur: number;
};

function groupSalesByAsset(sales: SaleReportRow[]): AssetSalesGroup[] {
  const byAsset = new Map<string, AssetSalesGroup>();
  for (const s of sales) {
    let g = byAsset.get(s.assetId);
    if (!g) {
      g = {
        label: s.assetName ?? s.assetId,
        isin: s.isin,
        ops: 0,
        quantity: 0,
        proceedsEur: 0,
        costBasisEur: 0,
        feesEur: 0,
        rawGainLossEur: 0,
        nonComputableLossEur: 0,
        computableGainLossEur: 0,
      };
      byAsset.set(s.assetId, g);
    }
    g.ops += 1;
    g.quantity += s.quantity;
    g.proceedsEur += s.proceedsEur;
    g.costBasisEur += s.costBasisEur;
    g.feesEur += s.feesEur;
    g.rawGainLossEur += s.rawGainLossEur;
    g.nonComputableLossEur += s.nonComputableLossEur;
    g.computableGainLossEur += s.computableGainLossEur;
  }
  return [...byAsset.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

type AssetDividendGroup = {
  label: string;
  isin: string | null;
  country: string | null;
  payments: number;
  grossEur: number;
  withholdingOrigenEur: number;
  withholdingDestinoEur: number;
  netEur: number;
};

function groupDividendsByAsset(dividends: DividendReportRow[]): AssetDividendGroup[] {
  const byAsset = new Map<string, AssetDividendGroup>();
  for (const d of dividends) {
    let g = byAsset.get(d.assetId);
    if (!g) {
      g = {
        label: d.assetName ?? d.assetId,
        isin: d.isin,
        country: d.sourceCountry,
        payments: 0,
        grossEur: 0,
        withholdingOrigenEur: 0,
        withholdingDestinoEur: 0,
        netEur: 0,
      };
      byAsset.set(d.assetId, g);
    }
    g.payments += 1;
    g.grossEur += d.grossEur;
    g.withholdingOrigenEur += d.withholdingOrigenEur;
    g.withholdingDestinoEur += d.withholdingDestinoEur;
    g.netEur += d.netEur;
  }
  return [...byAsset.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function buildTaxReportPdf(input: TaxPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 40;

  const ensureRoom = (needed: number) => {
    if (y + needed > PAGE_BOTTOM) {
      doc.addPage();
      y = 40;
    }
  };
  const sectionTitle = (text: string) => {
    ensureRoom(40);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(text, L, y);
    y += 6;
    doc.setDrawColor(120);
    doc.line(L, y, R, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
  };
  const kv = (label: string, value: string, bold = false) => {
    ensureRoom(14);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, L, y);
    doc.text(value, R, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 13;
  };
  const truncate = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

  // ── Cabecera ────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`Informe fiscal IRPF — ejercicio ${input.year}`, L, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    input.sealedAt
      ? `Ejercicio sellado el ${new Date(input.sealedAt).toISOString().slice(0, 10)}`
      : "Ejercicio sin sellar (datos en vivo)",
    L,
    y,
  );
  doc.setTextColor(0);
  y += 16;

  // ── 1. Resumen del ejercicio ────────────────────────────────────────────
  const t = input.report.totals;
  sectionTitle("1. Resumen del ejercicio");
  kv("Importe total de transmisiones", fmt(t.proceedsEur));
  kv("Coste de adquisición (FIFO, comisiones de compra incluidas)", fmt(t.costBasisEur));
  kv("Comisiones de venta deducidas", fmt(t.feesEur));
  kv("Ganancias patrimoniales realizadas", fmt(t.realizedGainsEur));
  kv("Pérdidas patrimoniales computables", fmt(t.realizedLossesComputableEur));
  kv("Pérdidas no computables (recompra, art. 33.5)", fmt(t.nonComputableLossesEur));
  kv("Saldo neto computable de ganancias y pérdidas", fmt(t.netComputableEur), true);
  kv("Dividendos brutos", fmt(t.dividendsGrossEur));
  kv("Retenciones en origen (extranjero)", fmt(t.withholdingOrigenTotalEur));
  kv("Retenciones en destino (pagos a cuenta)", fmt(t.withholdingDestinoTotalEur));
  if (input.interestEur !== 0) kv("Intereses de cuentas (RCM)", fmt(input.interestEur));
  if (input.report.excludedSales && input.report.excludedSales.count > 0) {
    ensureRoom(14);
    doc.setTextColor(90);
    doc.setFontSize(8);
    doc.text(
      `Nota: ${input.report.excludedSales.count} microtransmisiones excluidas por umbral de 1 € ` +
        `(transmisión ${fmt(input.report.excludedSales.proceedsEur)}, coste ${fmt(input.report.excludedSales.costBasisEur)}).`,
      L,
      y,
    );
    doc.setTextColor(0);
    doc.setFontSize(9);
    y += 13;
  }

  // ── 2. Estimación de cuota (base del ahorro foral) ──────────────────────
  const est = estimateSavingsCuota(input.report, input.interestEur);
  sectionTitle("2. Estimación de cuota — base del ahorro");
  doc.setTextColor(90);
  doc.setFontSize(8);
  ensureRoom(12);
  doc.text(est.scaleLabel + " — territorios históricos de Bizkaia, Gipuzkoa y Álava (armonizada)", L, y);
  doc.setTextColor(0);
  doc.setFontSize(9);
  y += 14;
  kv("Saldo de ganancias y pérdidas (transmisiones)", fmt(est.saldoGananciasEur));
  kv("Saldo de rendimientos del capital mobiliario", fmt(est.saldoRcmEur));
  if (est.lossOffsetAppliedEur > 0) {
    kv("Pérdida compensada contra RCM (límite 25%)", fmt(-est.lossOffsetAppliedEur));
  }
  if (est.lossCarryForwardEur > 0) {
    kv("Pérdida pendiente de compensar (4 ejercicios siguientes)", fmt(est.lossCarryForwardEur));
  }
  kv("Base liquidable del ahorro estimada", fmt(est.baseAhorroEur), true);
  kv("Cuota íntegra estimada", fmt(est.cuotaIntegraEur), true);
  kv("Deducción doble imposición internacional (casilla 0588)", fmt(-est.ddiCreditEur));
  kv("Retenciones ya practicadas en destino", fmt(-est.withholdingDestinoEur));
  kv(
    est.resultadoEstimadoEur >= 0 ? "Resultado estimado (a ingresar)" : "Resultado estimado (a devolver)",
    fmt(est.resultadoEstimadoEur),
    true,
  );
  ensureRoom(24);
  doc.setTextColor(90);
  doc.setFontSize(8);
  doc.text(
    "Estimación orientativa de la base del ahorro aislada: no incluye base general, mínimos personales,",
    L,
    y,
  );
  y += 10;
  doc.text(
    "otras deducciones ni saldos negativos de ejercicios anteriores. El cálculo vinculante es el del programa de renta foral.",
    L,
    y,
  );
  doc.setTextColor(0);
  doc.setFontSize(9);
  y += 14;

  // ── 3. Ganancias y pérdidas por activo ──────────────────────────────────
  sectionTitle("3. Ganancias y pérdidas patrimoniales por activo");
  const salesGroups = groupSalesByAsset(input.report.sales);
  if (salesGroups.length === 0) {
    kv("Sin transmisiones en el ejercicio", "—");
  } else {
    const cols: { label: string; x: number }[] = [
      { label: "Ops.", x: 250 },
      { label: "Transmisión", x: 325 },
      { label: "Coste adq.", x: 400 },
      { label: "Comisiones", x: 465 },
      { label: "Computable", x: R },
    ];
    const header = () => {
      ensureRoom(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("Activo", L, y);
      for (const c of cols) doc.text(c.label, c.x, y, { align: "right" });
      y += 5;
      doc.setDrawColor(180);
      doc.line(L, y, R, y);
      y += 10;
      doc.setFont("helvetica", "normal");
    };
    header();
    for (const g of salesGroups) {
      if (y + 24 > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
        header();
      }
      doc.setFontSize(8);
      doc.text(truncate(g.label, 42), L, y);
      doc.text(String(g.ops), cols[0].x, y, { align: "right" });
      doc.text(fmt(g.proceedsEur), cols[1].x, y, { align: "right" });
      doc.text(fmt(g.costBasisEur), cols[2].x, y, { align: "right" });
      doc.text(fmt(g.feesEur), cols[3].x, y, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(fmt(g.computableGainLossEur), cols[4].x, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      y += 10;
      doc.setTextColor(90);
      doc.setFontSize(7);
      const detail = [
        g.isin ? `ISIN ${g.isin}` : null,
        `cantidad ${g.quantity.toLocaleString("es-ES", { maximumFractionDigits: 8 })}`,
        g.nonComputableLossEur !== 0
          ? `pérdida no computable art. 33.5: ${fmt(g.nonComputableLossEur)} (G/P bruta ${fmt(g.rawGainLossEur)})`
          : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      doc.text(detail, L + 8, y);
      doc.setTextColor(0);
      doc.setFontSize(8);
      y += 12;
    }
    ensureRoom(16);
    doc.setDrawColor(180);
    doc.line(L, y - 6, R, y - 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Total", L, y + 4);
    doc.text(fmt(t.proceedsEur), cols[1].x, y + 4, { align: "right" });
    doc.text(fmt(t.costBasisEur), cols[2].x, y + 4, { align: "right" });
    doc.text(fmt(t.feesEur), cols[3].x, y + 4, { align: "right" });
    doc.text(fmt(t.netComputableEur), cols[4].x, y + 4, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y += 18;
  }

  // ── 4. Dividendos por activo ────────────────────────────────────────────
  sectionTitle("4. Dividendos por activo");
  const dividendGroups = groupDividendsByAsset(input.report.dividends);
  if (dividendGroups.length === 0) {
    kv("Sin dividendos en el ejercicio", "—");
  } else {
    const cols: { label: string; x: number }[] = [
      { label: "País", x: 250 },
      { label: "Pagos", x: 285 },
      { label: "Bruto", x: 355 },
      { label: "Ret. origen", x: 425 },
      { label: "Ret. destino", x: 492 },
      { label: "Neto", x: R },
    ];
    const header = () => {
      ensureRoom(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("Activo", L, y);
      for (const c of cols) doc.text(c.label, c.x, y, { align: "right" });
      y += 5;
      doc.setDrawColor(180);
      doc.line(L, y, R, y);
      y += 10;
      doc.setFont("helvetica", "normal");
    };
    header();
    for (const g of dividendGroups) {
      if (y + 14 > PAGE_BOTTOM) {
        doc.addPage();
        y = 40;
        header();
      }
      doc.setFontSize(8);
      doc.text(truncate(g.label, 42), L, y);
      doc.text(g.country ?? "—", cols[0].x, y, { align: "right" });
      doc.text(String(g.payments), cols[1].x, y, { align: "right" });
      doc.text(fmt(g.grossEur), cols[2].x, y, { align: "right" });
      doc.text(fmt(g.withholdingOrigenEur), cols[3].x, y, { align: "right" });
      doc.text(fmt(g.withholdingDestinoEur), cols[4].x, y, { align: "right" });
      doc.text(fmt(g.netEur), cols[5].x, y, { align: "right" });
      y += 12;
    }
    ensureRoom(16);
    doc.setDrawColor(180);
    doc.line(L, y - 6, R, y - 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Total", L, y + 4);
    doc.text(fmt(t.dividendsGrossEur), cols[2].x, y + 4, { align: "right" });
    doc.text(fmt(t.withholdingOrigenTotalEur), cols[3].x, y + 4, { align: "right" });
    doc.text(fmt(t.withholdingDestinoTotalEur), cols[4].x, y + 4, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y += 18;
  }

  // ── 5. Casillas Modelo 100 ──────────────────────────────────────────────
  sectionTitle("5. Casillas — Modelo 100 foral");
  kv("0326 — Ganancias patrimoniales (transmisión)", fmt(t.realizedGainsEur));
  kv("0340 — Pérdidas computables", fmt(Math.abs(t.realizedLossesComputableEur)));
  kv("0343 — Saldo neto de ganancias y pérdidas", fmt(t.netComputableEur));
  kv("0027 — Rendimientos del capital mobiliario (dividendos brutos)", fmt(t.dividendsGrossEur));
  kv(
    "0029 — Retenciones e ingresos a cuenta",
    fmt(t.withholdingOrigenTotalEur + t.withholdingDestinoTotalEur),
  );
  kv("0588 — Deducción por doble imposición internacional", fmt(est.ddiCreditEur));

  // ── 6. Modelos informativos ─────────────────────────────────────────────
  sectionTitle("6. Modelos informativos (720 / 721 / D-6)");
  const renderBlocks = (label: string, blocks: InformationalModelsStatus["m720"]["blocks"]) => {
    ensureRoom(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, L, y);
    doc.setFont("helvetica", "normal");
    y += 12;
    if (blocks.length === 0) {
      doc.setTextColor(90);
      doc.text("Sin bloques declarables", L + 8, y);
      doc.setTextColor(0);
      y += 12;
      return;
    }
    for (const b of blocks) {
      ensureRoom(12);
      const flag = b.hasUnvalued ? "  [SIN VALORAR — incompleto]" : b.hasStale ? "  [valoración desfasada]" : "";
      doc.setFontSize(8);
      doc.text(`${b.country}  ·  ${b.type}  ·  ${b.status}${flag}`, L + 8, y);
      doc.text(fmt(b.valueEur), R, y, { align: "right" });
      y += 11;
    }
    y += 4;
  };
  renderBlocks("Modelo 720 — bienes y derechos en el extranjero", input.models.m720.blocks);
  renderBlocks("Modelo 721 — monedas virtuales en el extranjero", input.models.m721.blocks);
  renderBlocks("D-6 — valores negociables depositados en el extranjero", input.models.d6.blocks);

  // ── Pie ─────────────────────────────────────────────────────────────────
  ensureRoom(20);
  y += 6;
  doc.setTextColor(120);
  doc.setFontSize(7);
  doc.text(
    "Documento generado por Finances Panel. Estimaciones orientativas según normativa foral armonizada; no constituye asesoramiento fiscal.",
    L,
    y,
  );
  doc.setTextColor(0);

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
