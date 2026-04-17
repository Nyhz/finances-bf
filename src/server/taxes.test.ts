import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import type { DB } from "../db/client";
import {
  computeDividendAndInterestForYear,
  computeRealizedGainsForYear,
} from "./taxes";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function seedAccountAndAsset(db: DB, opts?: { assetCurrency?: string }) {
  db.insert(schema.accounts)
    .values({
      id: "acc_1",
      name: "Broker",
      currency: "EUR",
      accountType: "broker",
    })
    .run();
  db.insert(schema.assets)
    .values({
      id: "ast_1",
      name: "ACME",
      assetType: "stock",
      currency: opts?.assetCurrency ?? "EUR",
    })
    .run();
}

type TradeSeed = {
  id: string;
  side: "buy" | "sell";
  tradedAt: number;
  quantity: number;
  unitPrice: number;
  tradeCurrency?: string;
  fxRateToEur?: number;
  feesEur?: number;
};

function insertTrade(db: DB, t: TradeSeed) {
  const tradeCurrency = t.tradeCurrency ?? "EUR";
  const fxRateToEur = t.fxRateToEur ?? 1;
  const gross = t.quantity * t.unitPrice;
  const grossEur = gross * fxRateToEur;
  const feesEur = t.feesEur ?? 0;
  const sign = t.side === "buy" ? -1 : 1;
  db.insert(schema.assetTransactions)
    .values({
      id: t.id,
      accountId: "acc_1",
      assetId: "ast_1",
      transactionType: t.side,
      tradedAt: t.tradedAt,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      tradeCurrency,
      fxRateToEur,
      tradeGrossAmount: gross,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: sign * grossEur - feesEur,
      feesAmount: feesEur / fxRateToEur,
      feesAmountEur: feesEur,
      netAmountEur: sign * grossEur - feesEur,
    })
    .run();
}

const D = (iso: string) => Date.UTC(
  Number(iso.slice(0, 4)),
  Number(iso.slice(5, 7)) - 1,
  Number(iso.slice(8, 10)),
);

describe("computeRealizedGainsForYear — FIFO", () => {
  let db: DB;
  beforeEach(() => {
    db = makeDb();
  });

  it("FIFO across multiple buys with a partial sell", async () => {
    seedAccountAndAsset(db);
    // Buy 10 @ 10 EUR (2026-01-10): cost 100
    insertTrade(db, {
      id: "tx_b1",
      side: "buy",
      tradedAt: D("2026-01-10"),
      quantity: 10,
      unitPrice: 10,
    });
    // Buy 10 @ 20 EUR (2026-02-10): cost 200
    insertTrade(db, {
      id: "tx_b2",
      side: "buy",
      tradedAt: D("2026-02-10"),
      quantity: 10,
      unitPrice: 20,
    });
    // Sell 15 @ 25 EUR (2026-06-01): consumes 10 @ 10 + 5 @ 20 = 200 cost
    insertTrade(db, {
      id: "tx_s1",
      side: "sell",
      tradedAt: D("2026-06-01"),
      quantity: 15,
      unitPrice: 25,
    });

    const r = await computeRealizedGainsForYear(2026, db);
    expect(r.sales).toHaveLength(1);
    const s = r.sales[0];
    expect(s.proceedsEur).toBe(15 * 25);
    expect(s.costBasisEur).toBeCloseTo(10 * 10 + 5 * 20, 6);
    expect(s.realizedGainEur).toBeCloseTo(375 - 200, 6);
    expect(r.totals.realizedGainsEur).toBeCloseTo(175, 6);
    expect(r.totals.realizedLossesEur).toBe(0);
    expect(r.totals.netRealizedEur).toBeCloseTo(175, 6);
  });

  it("FIFO spanning years: only the sell-year's realized portion is counted", async () => {
    seedAccountAndAsset(db);
    // 2025: buy 10 @ 10, sell 4 @ 15 (realized in 2025, must be excluded from 2026)
    insertTrade(db, {
      id: "tx_b_2025",
      side: "buy",
      tradedAt: D("2025-03-01"),
      quantity: 10,
      unitPrice: 10,
    });
    insertTrade(db, {
      id: "tx_s_2025",
      side: "sell",
      tradedAt: D("2025-09-01"),
      quantity: 4,
      unitPrice: 15,
    });
    // 2026: sell remaining 6 @ 20 — consumes leftover 6 from the 2025 buy at 10
    insertTrade(db, {
      id: "tx_s_2026",
      side: "sell",
      tradedAt: D("2026-04-01"),
      quantity: 6,
      unitPrice: 20,
    });

    const r2026 = await computeRealizedGainsForYear(2026, db);
    expect(r2026.sales).toHaveLength(1);
    expect(r2026.sales[0].saleId).toBe("tx_s_2026");
    expect(r2026.sales[0].proceedsEur).toBe(120);
    expect(r2026.sales[0].costBasisEur).toBeCloseTo(60, 6);
    expect(r2026.sales[0].realizedGainEur).toBeCloseTo(60, 6);

    const r2025 = await computeRealizedGainsForYear(2025, db);
    expect(r2025.sales).toHaveLength(1);
    expect(r2025.sales[0].saleId).toBe("tx_s_2025");
    expect(r2025.sales[0].realizedGainEur).toBeCloseTo(60 - 40, 6);
  });

  it("returns empty aggregates with no throw for a zero-transactions year", async () => {
    const r = await computeRealizedGainsForYear(2026, db);
    expect(r.sales).toEqual([]);
    expect(r.totals).toEqual({
      realizedGainsEur: 0,
      realizedLossesEur: 0,
      netRealizedEur: 0,
      proceedsEur: 0,
      costBasisEur: 0,
      feesEur: 0,
    });

    const cash = await computeDividendAndInterestForYear(2026, db);
    expect(cash).toEqual({ dividendsEur: 0, interestEur: 0, totalEur: 0 });
  });

  it("non-EUR native: proceedsEur uses the fxRateToEur snapshot on the sell trade", async () => {
    seedAccountAndAsset(db, { assetCurrency: "USD" });
    // Buy 10 @ $100 with fx 1.0 → cost EUR 1000
    insertTrade(db, {
      id: "tx_b_usd",
      side: "buy",
      tradedAt: D("2026-01-10"),
      quantity: 10,
      unitPrice: 100,
      tradeCurrency: "USD",
      fxRateToEur: 1.0,
    });
    // Sell 10 @ $120 with snapshot fx 0.9 → grossEur = 10*120*0.9 = 1080
    insertTrade(db, {
      id: "tx_s_usd",
      side: "sell",
      tradedAt: D("2026-06-01"),
      quantity: 10,
      unitPrice: 120,
      tradeCurrency: "USD",
      fxRateToEur: 0.9,
    });

    const r = await computeRealizedGainsForYear(2026, db);
    expect(r.sales).toHaveLength(1);
    const s = r.sales[0];
    // Must reflect the snapshot on the sell row, not a re-resolved rate.
    expect(s.proceedsEur).toBeCloseTo(1080, 6);
    expect(s.costBasisEur).toBeCloseTo(1000, 6);
    expect(s.realizedGainEur).toBeCloseTo(80, 6);
  });
});

describe("computeDividendAndInterestForYear", () => {
  it("aggregates dividend and interest movements by year", async () => {
    const db = makeDb();
    db.insert(schema.accounts)
      .values({ id: "acc_1", name: "B", currency: "EUR", accountType: "broker" })
      .run();

    function insertMovement(id: string, type: string, when: number, eur: number) {
      db.insert(schema.accountCashMovements)
        .values({
          id,
          accountId: "acc_1",
          movementType: type,
          occurredAt: when,
          nativeAmount: eur,
          currency: "EUR",
          fxRateToEur: 1,
          cashImpactEur: eur,
        })
        .run();
    }

    insertMovement("m1", "dividend", D("2026-03-01"), 50);
    insertMovement("m2", "dividend", D("2026-07-01"), 30);
    insertMovement("m3", "interest", D("2026-04-01"), 10);
    // Other year — ignored.
    insertMovement("m4", "dividend", D("2025-06-01"), 999);
    // Other kind — ignored.
    insertMovement("m5", "deposit", D("2026-01-01"), 1000);

    const r = await computeDividendAndInterestForYear(2026, db);
    expect(r.dividendsEur).toBeCloseTo(80, 6);
    expect(r.interestEur).toBeCloseTo(10, 6);
    expect(r.totalEur).toBeCloseTo(90, 6);
  });
});
