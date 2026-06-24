import "server-only";
import { DAY_MS } from "../time";
import { round } from "../money";
import type { HistoricalBar, Quote } from "../pricing/types";
import {
  criterionByKey,
  SECTOR_ETF,
  type CriterionVerdict,
  type DiscoverMetrics,
} from "./criteria";
import { momentum, pctBelow52wHigh, pctChange, rollingMax, sma } from "./ta";

// Deterministic verification of a Discover candidate: pull the symbol's real
// daily history, compute the metrics, and let the criterion decide
// confirmed/refuted/unverifiable. The agent proposes; THIS decides — so a
// hallucinated "−23% from highs" can never reach the UI. Resilient: any data
// gap → unverifiable, never throws into the run.

export type VerifyClients = {
  fetchHistory: (symbol: string, from: Date, to: Date) => Promise<HistoricalBar[]>;
  fetchQuote: (symbol: string) => Promise<Quote>;
  fetchAssetSector: (symbol: string) => Promise<string | null>;
};

export type VerifiedCandidate = {
  status: CriterionVerdict["status"];
  detail: string;
  metrics: DiscoverMetrics;
};

const HISTORY_DAYS = 420; // > 252 trading sessions: enough for DMA200 + 52w high
const SESSIONS_3M = 63;

const EMPTY_METRICS: DiscoverMetrics = {
  price: null,
  currency: null,
  dma200: null,
  pctVsDma200: null,
  drawdown30d: null,
  momentum20d: null,
  pctBelow52wHigh: null,
  sector: null,
  sectorStrength3m: null,
  ownReturn3m: null,
};

export async function verifyCandidate(
  symbol: string,
  criterionKey: string,
  clients: VerifyClients,
  now: Date = new Date(),
): Promise<VerifiedCandidate> {
  const criterion = criterionByKey(criterionKey);
  if (!criterion) {
    return { status: "unverifiable", detail: "Criterio desconocido", metrics: EMPTY_METRICS };
  }

  let bars: HistoricalBar[];
  try {
    const from = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    bars = await clients.fetchHistory(symbol, from, now);
  } catch {
    return {
      status: "unverifiable",
      detail: "Sin datos de mercado para el símbolo",
      metrics: EMPTY_METRICS,
    };
  }
  if (bars.length < 30) {
    return { status: "unverifiable", detail: "Histórico insuficiente", metrics: EMPTY_METRICS };
  }
  const closes = bars.map((b) => b.close);

  // Live price + currency, falling back to the last close.
  let price = closes[closes.length - 1];
  let currency: string | null = bars[bars.length - 1]?.currency ?? null;
  try {
    const q = await clients.fetchQuote(symbol);
    price = q.price;
    currency = q.currency;
  } catch {
    /* keep the last close */
  }

  const dma200 = sma(closes, 200);
  const high30 = rollingMax(closes, 30);
  const metrics: DiscoverMetrics = {
    price: round(price, 6),
    currency,
    dma200,
    pctVsDma200: dma200 != null ? pctChange(dma200, price) : null,
    drawdown30d: high30 != null ? pctChange(high30, price) : null,
    momentum20d: momentum(closes, 20),
    pctBelow52wHigh: pctBelow52wHigh(closes),
    sector: null,
    sectorStrength3m: null,
    ownReturn3m: null,
  };

  // The sector-strength data is only needed (and only fetched) for the laggard
  // screen — keeps the common path to a single history call.
  if (criterion.key === "hot_sector_laggard") {
    try {
      const sector = await clients.fetchAssetSector(symbol);
      metrics.sector = sector;
      const etf = sector ? SECTOR_ETF[sector] : undefined;
      if (etf) {
        const from = new Date(now.getTime() - 140 * DAY_MS);
        const etfBars = await clients.fetchHistory(etf, from, now);
        metrics.sectorStrength3m = momentum(
          etfBars.map((b) => b.close),
          SESSIONS_3M,
        );
      }
      metrics.ownReturn3m = momentum(closes, SESSIONS_3M);
    } catch {
      /* leave nulls → criterion reports unverifiable */
    }
  }

  const verdict = criterion.verify(metrics);
  return { status: verdict.status, detail: verdict.detail, metrics };
}
