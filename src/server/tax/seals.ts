import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";
import { buildTaxReport, type TaxReport } from "./report";

export type Snapshot = {
  year: number;
  sealedAt: number;
  payload: { report: TaxReport; m720?: unknown; m721?: unknown; d6?: unknown };
};

export type DriftReport = {
  year: number;
  netComputableEurDelta: number;
  dividendsGrossEurDelta: number;
  withholdingOrigenTotalEurDelta: number;
  nonComputableLossesEurDelta: number;
  salesCountDelta: number;
  dividendsCountDelta: number;
};

export function getSnapshot(db: DB, year: number): Snapshot | null {
  const row = db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payloadJson) as Snapshot["payload"];
    return { year: row.year, sealedAt: row.sealedAt, payload };
  } catch {
    return null;
  }
}

export function computeDriftSinceSeal(db: DB, year: number): DriftReport | null {
  const snap = getSnapshot(db, year);
  if (!snap) return null;
  const live = buildTaxReport(db, year);
  const sealed = snap.payload.report;
  const drift: DriftReport = {
    year,
    netComputableEurDelta: round(live.totals.netComputableEur - sealed.totals.netComputableEur),
    dividendsGrossEurDelta: round(live.totals.dividendsGrossEur - sealed.totals.dividendsGrossEur),
    withholdingOrigenTotalEurDelta: round(live.totals.withholdingOrigenTotalEur - sealed.totals.withholdingOrigenTotalEur),
    nonComputableLossesEurDelta: round(live.totals.nonComputableLossesEur - sealed.totals.nonComputableLossesEur),
    salesCountDelta: live.sales.length - sealed.sales.length,
    dividendsCountDelta: live.dividends.length - sealed.dividends.length,
  };
  if (
    drift.netComputableEurDelta === 0 &&
    drift.dividendsGrossEurDelta === 0 &&
    drift.withholdingOrigenTotalEurDelta === 0 &&
    drift.nonComputableLossesEurDelta === 0 &&
    drift.salesCountDelta === 0 &&
    drift.dividendsCountDelta === 0
  ) return null;
  return drift;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
