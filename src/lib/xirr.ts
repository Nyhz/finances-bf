/** Money-weighted return (XIRR): the annual rate that makes the NPV of the
 *  investor's actual cash flows zero. Unlike the TWR index (which strips
 *  contributions to measure the *portfolio*), XIRR weighs every euro by how
 *  long it was invested — it measures the *investor*, entry dates included. */

export type CashFlow = {
  dateIso: string; // yyyy-MM-dd
  /** Investor perspective: money in (buys/deposits) negative, money out
   *  (sales, dividends, final value) positive. */
  amountEur: number;
};

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
/** Annualising a few days of movement produces absurd rates — below this
 *  span the metric is noise, not information. */
const MIN_SPAN_DAYS = 30;
const LOW = -0.9999;
const HIGH = 10; // +1000 %/year — beyond this, something else is wrong

function npv(flows: Array<{ years: number; amount: number }>, rate: number): number {
  let acc = 0;
  for (const f of flows) {
    acc += f.amount / (1 + rate) ** f.years;
  }
  return acc;
}

export function computeXirr(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;
  const sorted = [...cashFlows]
    .filter((f) => f.amountEur !== 0)
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  if (sorted.length < 2) return null;
  const hasNegative = sorted.some((f) => f.amountEur < 0);
  const hasPositive = sorted.some((f) => f.amountEur > 0);
  if (!hasNegative || !hasPositive) return null;

  const t0 = new Date(`${sorted[0].dateIso}T12:00:00Z`).getTime();
  const tn = new Date(`${sorted[sorted.length - 1].dateIso}T12:00:00Z`).getTime();
  if (tn - t0 < MIN_SPAN_DAYS * 24 * 3600 * 1000) return null;

  const flows = sorted.map((f) => ({
    years: (new Date(`${f.dateIso}T12:00:00Z`).getTime() - t0) / MS_PER_YEAR,
    amount: f.amountEur,
  }));

  // Bisection: NPV is monotonically decreasing in rate for one sign change
  // pattern, but real ledgers can wiggle — bisection only needs a bracket.
  let lo = LOW;
  let hi = HIGH;
  let fLo = npv(flows, lo);
  const fHi = npv(flows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) return null; // no root in range

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(flows, mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-10) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
