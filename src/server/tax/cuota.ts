import { roundEur } from "../../lib/money";
import { ddiTreatyRate } from "./countries";

/**
 * Escala foral del ahorro (Bizkaia / Gipuzkoa / Álava, armonizada).
 *
 * La cuota que sale de aquí es una ESTIMACIÓN orientativa de la base del
 * ahorro aislada (sin mínimos personales, sin otras deducciones de cuota,
 * sin la base general). El cálculo vinculante lo hace el programa de renta
 * de la hacienda foral correspondiente.
 */

export type SavingsBracket = {
  /** Límite superior del tramo en EUR; null = sin límite (último tramo). */
  upToEur: number | null;
  /** Tipo marginal del tramo (0..1). */
  rate: number;
};

export type SavingsScale = {
  /** Etiqueta humana, p. ej. "Escala foral del ahorro 2026 (19%–28%)". */
  label: string;
  brackets: SavingsBracket[];
};

// Art. 76 NF 13/2013 (Bizkaia) y equivalentes en Gipuzkoa/Álava, redacción
// vigente hasta el ejercicio 2025.
const SCALE_THROUGH_2025: SavingsScale = {
  label: "Escala foral del ahorro hasta 2025 (20%–25%)",
  brackets: [
    { upToEur: 2_500, rate: 0.2 },
    { upToEur: 10_000, rate: 0.21 },
    { upToEur: 15_000, rate: 0.22 },
    { upToEur: 30_000, rate: 0.23 },
    { upToEur: null, rate: 0.25 },
  ],
};

// Nueva tarifa progresiva armonizada con efectos desde el ejercicio 2026
// (reforma NF IRPF 2026 de los tres territorios históricos).
const SCALE_FROM_2026: SavingsScale = {
  label: "Escala foral del ahorro desde 2026 (19%–28%)",
  brackets: [
    { upToEur: 7_500, rate: 0.19 },
    { upToEur: 15_000, rate: 0.2 },
    { upToEur: 30_000, rate: 0.22 },
    { upToEur: 50_000, rate: 0.24 },
    { upToEur: 90_000, rate: 0.255 },
    { upToEur: 120_000, rate: 0.26 },
    { upToEur: 240_000, rate: 0.265 },
    { upToEur: 300_000, rate: 0.27 },
    { upToEur: null, rate: 0.28 },
  ],
};

export function savingsScaleForYear(year: number): SavingsScale {
  return year >= 2026 ? SCALE_FROM_2026 : SCALE_THROUGH_2025;
}

/** Cuota íntegra de una base liquidable del ahorro positiva. */
export function applySavingsScale(baseEur: number, scale: SavingsScale): number {
  if (baseEur <= 0) return 0;
  let cuota = 0;
  let floor = 0;
  for (const bracket of scale.brackets) {
    const ceiling = bracket.upToEur ?? Number.POSITIVE_INFINITY;
    const slice = Math.min(baseEur, ceiling) - floor;
    if (slice <= 0) break;
    cuota += slice * bracket.rate;
    floor = ceiling;
  }
  return roundEur(cuota);
}

// Compensación foral en la base del ahorro (art. 66 NF 13/2013 y equivalentes):
// el saldo negativo de ganancias/pérdidas por transmisiones solo compensa el
// saldo positivo de rendimientos del capital mobiliario hasta el 25% de éste;
// el resto queda pendiente para los 4 ejercicios siguientes.
const LOSS_OFFSET_CAP = 0.25;

/** Subconjunto estructural de TaxReport que necesita la estimación. */
export type CuotaEstimateInput = {
  year: number;
  dividends: ReadonlyArray<{
    grossEur: number;
    withholdingOrigenEur: number;
    sourceCountry: string | null;
  }>;
  totals: {
    netComputableEur: number;
    dividendsGrossEur: number;
    withholdingDestinoTotalEur: number;
  };
};

export type CuotaEstimate = {
  scaleLabel: string;
  /** Saldo de ganancias/pérdidas patrimoniales computables (puede ser negativo). */
  saldoGananciasEur: number;
  /** Saldo de rendimientos del capital mobiliario (dividendos brutos + intereses). */
  saldoRcmEur: number;
  /** Pérdida compensada contra RCM este ejercicio (límite 25% del saldo RCM). */
  lossOffsetAppliedEur: number;
  /** Pérdida que queda pendiente de compensar en los 4 ejercicios siguientes. */
  lossCarryForwardEur: number;
  baseAhorroEur: number;
  cuotaIntegraEur: number;
  /** Deducción por doble imposición internacional (casilla 0588), por dividendo
   *  min(retención en origen, tipo de convenio × bruto), topada a la cuota. */
  ddiCreditEur: number;
  /** Retenciones ya practicadas en destino (pagos a cuenta). */
  withholdingDestinoEur: number;
  /** Cuota íntegra − DDI − retenciones destino. Negativo = a devolver. */
  resultadoEstimadoEur: number;
};

export function estimateSavingsCuota(report: CuotaEstimateInput, interestEur = 0): CuotaEstimate {
  const scale = savingsScaleForYear(report.year);

  const saldoGanancias = roundEur(report.totals.netComputableEur);
  const saldoRcm = roundEur(report.totals.dividendsGrossEur + interestEur);

  let lossOffsetApplied = 0;
  let lossCarryForward = 0;
  let baseAhorro: number;
  if (saldoGanancias >= 0) {
    baseAhorro = roundEur(saldoGanancias + saldoRcm);
  } else {
    const loss = -saldoGanancias;
    lossOffsetApplied = roundEur(Math.min(loss, Math.max(0, saldoRcm) * LOSS_OFFSET_CAP));
    lossCarryForward = roundEur(loss - lossOffsetApplied);
    baseAhorro = roundEur(Math.max(0, saldoRcm - lossOffsetApplied));
  }

  const cuotaIntegra = applySavingsScale(baseAhorro, scale);

  const ddiUncapped = report.dividends.reduce((sum, d) => {
    const cap = ddiTreatyRate(d.sourceCountry ?? "") * d.grossEur;
    return sum + Math.min(d.withholdingOrigenEur, cap);
  }, 0);
  const ddiCredit = roundEur(Math.min(ddiUncapped, cuotaIntegra));

  const withholdingDestino = roundEur(report.totals.withholdingDestinoTotalEur);
  const resultado = roundEur(cuotaIntegra - ddiCredit - withholdingDestino);

  return {
    scaleLabel: scale.label,
    saldoGananciasEur: saldoGanancias,
    saldoRcmEur: saldoRcm,
    lossOffsetAppliedEur: lossOffsetApplied,
    lossCarryForwardEur: lossCarryForward,
    baseAhorroEur: baseAhorro,
    cuotaIntegraEur: cuotaIntegra,
    ddiCreditEur: ddiCredit,
    withholdingDestinoEur: withholdingDestino,
    resultadoEstimadoEur: resultado,
  };
}
