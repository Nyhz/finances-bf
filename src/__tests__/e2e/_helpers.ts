import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

/**
 * Build a fresh in-memory SQLite with the full Drizzle schema migrated.
 * Each test gets an isolated DB — no cross-test state.
 */
export function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

export type FxBarStub = { iso: string; rateToEur: number };

/**
 * Helper to build a synthetic set of daily FX bars spanning a date range.
 * Rate can be constant or a function of day index.
 */
export function mkFxBars(
  fromIso: string,
  toIso: string,
  rateFn: number | ((i: number) => number),
  opts: { weekdaysOnly?: boolean } = {},
): FxBarStub[] {
  const out: FxBarStub[] = [];
  const end = new Date(`${toIso}T12:00:00Z`).getTime();
  let i = 0;
  for (
    let t = new Date(`${fromIso}T12:00:00Z`).getTime();
    t <= end;
    t += 86_400_000
  ) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (opts.weekdaysOnly !== false) {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
    }
    out.push({
      iso,
      rateToEur: typeof rateFn === "number" ? rateFn : rateFn(i),
    });
    i += 1;
  }
  return out;
}

// FX bank used by the mocked `resolveFxRange`. Exposed as a module singleton
// so `vi.mock()` in test files can close over it (vi.mock hoists factories
// above module code, which breaks in-function closures — a top-level Map
// survives the hoist).
type FxBankEntry = { bars: FxBarStub[]; source: "yahoo-fx" | "coingecko-fx" };
export const fxBank = new Map<string, FxBankEntry>();

export function setFx(
  ccy: string,
  bars: FxBarStub[],
  source: "yahoo-fx" | "coingecko-fx" = "yahoo-fx",
): void {
  fxBank.set(ccy.toUpperCase(), { bars, source });
}

export function clearFx(): void {
  fxBank.clear();
}

/**
 * The stubbed `resolveFxRange`. Reads from the shared module-level `fxBank`.
 * Unknown currencies throw — exercises atomic-abort in confirmImport.
 */
export async function resolveFxRangeStub(
  ccy: string,
): Promise<{
  currency: string;
  source: "yahoo-fx" | "coingecko-fx";
  bars: Array<{ iso: string; rateToEur: number; source: "yahoo-fx" | "coingecko-fx" }>;
}> {
  const upper = ccy.toUpperCase();
  if (upper === "EUR") {
    return { currency: upper, source: "yahoo-fx", bars: [] };
  }
  const entry = fxBank.get(upper);
  if (!entry) {
    throw new Error(
      `fx-mock: no bars registered for ${upper}. Call setFx() first.`,
    );
  }
  return {
    currency: upper,
    source: entry.source,
    bars: entry.bars.map((b) => ({
      iso: b.iso,
      rateToEur: b.rateToEur,
      source: entry.source,
    })),
  };
}

/**
 * Seed a synthetic `price_history` feed so valuation rebuilds have prices
 * to work with without hitting Yahoo / CoinGecko.
 */
export function seedPriceHistory(
  db: DB,
  symbol: string,
  fromIso: string,
  toIso: string,
  priceFn: number | ((i: number) => number),
  opts: { weekdaysOnly?: boolean } = {},
): void {
  const bars = mkFxBars(fromIso, toIso, priceFn, opts);
  const now = Date.now();
  for (const b of bars) {
    db
      .insert(schema.priceHistory)
      .values({
        id: crypto.randomUUID(),
        symbol,
        pricedAt: new Date(`${b.iso}T12:00:00Z`).getTime(),
        pricedDateUtc: b.iso,
        price: b.rateToEur,
        source: "test",
        createdAt: now,
      })
      .run();
  }
}
