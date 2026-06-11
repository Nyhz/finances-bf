/** Basic risk metrics over a performance-index series (100 = anchor). All
 *  pure functions — the index already strips contributions (TWR), so these
 *  measure market behaviour, not deposit timing. */

export type IndexPoint = { date: string; index: number };

export type DrawdownPoint = {
  date: string;
  /** 0 at a new high, negative below it (-0.12 = 12 % under the peak). */
  drawdown: number;
};

export type RiskMetrics = {
  /** Deepest peak-to-trough fall, as a negative fraction. */
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  /** Annualised standard deviation of daily returns (√252), fraction. Null
   *  with fewer than 20 observations — too noisy to be honest. */
  annualizedVolatility: number | null;
  worstDay: { date: string; dailyReturn: number } | null;
  bestDay: { date: string; dailyReturn: number } | null;
};

const TRADING_DAYS_PER_YEAR = 252;
const MIN_OBSERVATIONS_FOR_VOL = 20;

export function drawdownSeries(points: IndexPoint[]): DrawdownPoint[] {
  let peak = -Infinity;
  const out: DrawdownPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.index) || p.index <= 0) continue;
    peak = Math.max(peak, p.index);
    out.push({ date: p.date, drawdown: p.index / peak - 1 });
  }
  return out;
}

export function computeRiskMetrics(points: IndexPoint[]): RiskMetrics | null {
  const valid = points.filter((p) => Number.isFinite(p.index) && p.index > 0);
  if (valid.length < 2) return null;

  const dd = drawdownSeries(valid);
  let maxDrawdown = 0;
  let maxDrawdownDate: string | null = null;
  for (const p of dd) {
    if (p.drawdown < maxDrawdown) {
      maxDrawdown = p.drawdown;
      maxDrawdownDate = p.date;
    }
  }

  const returns: Array<{ date: string; r: number }> = [];
  for (let i = 1; i < valid.length; i++) {
    returns.push({ date: valid[i].date, r: valid[i].index / valid[i - 1].index - 1 });
  }

  let worstDay: RiskMetrics["worstDay"] = null;
  let bestDay: RiskMetrics["bestDay"] = null;
  for (const { date, r } of returns) {
    if (worstDay == null || r < worstDay.dailyReturn) worstDay = { date, dailyReturn: r };
    if (bestDay == null || r > bestDay.dailyReturn) bestDay = { date, dailyReturn: r };
  }

  let annualizedVolatility: number | null = null;
  if (returns.length >= MIN_OBSERVATIONS_FOR_VOL) {
    const mean = returns.reduce((s, x) => s + x.r, 0) / returns.length;
    const variance =
      returns.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (returns.length - 1);
    annualizedVolatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }

  return { maxDrawdown, maxDrawdownDate, annualizedVolatility, worstDay, bestDay };
}
