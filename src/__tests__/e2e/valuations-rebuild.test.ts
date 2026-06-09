import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { makeDb, seedPriceHistory } from "./_helpers";
import { rebuildValuationsForAsset } from "../../server/valuations";

function insertBuy(
  db: DB,
  assetId: string,
  accountId: string,
  date: string,
  qty: number,
  unitPriceNative: number,
  fx: number,
  currency: string,
): void {
  const now = Date.now();
  const tradedAt = new Date(`${date}T12:00:00Z`).getTime();
  const gross = qty * unitPriceNative;
  db
    .insert(schema.assetTransactions)
    .values({
      id: ulid(),
      accountId,
      assetId,
      transactionType: "buy",
      tradedAt,
      quantity: qty,
      unitPrice: unitPriceNative,
      tradeCurrency: currency,
      fxRateToEur: fx,
      tradeGrossAmount: gross,
      tradeGrossAmountEur: gross * fx,
      cashImpactEur: -(gross * fx),
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: -(gross * fx),
      rowFingerprint: ulid(),
      source: "manual",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("e2e — rebuildValuationsForAsset", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    const now = Date.now();
    accountId = ulid();
    db
      .insert(schema.accounts)
      .values({
        id: accountId,
        name: "T",
        accountType: "investment",
        currency: "EUR",
        openingBalanceEur: 0,
        currentCashBalanceEur: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  it("emits one row per weekday for stocks and uses fx_rates daily curve", async () => {
    const assetId = ulid();
    const now = Date.now();
    db
      .insert(schema.assets)
      .values({
        id: assetId,
        name: "UnitedHealth",
        assetType: "stock",
        symbol: "UNH",
        providerSymbol: "UNH",
        isin: "US91324P1021",
        currency: "USD",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    insertBuy(db, assetId, accountId, "2026-01-05", 2, 300, 1 / 1.09, "USD");
    seedPriceHistory(db, "UNH", "2026-01-05", "2026-02-05", 310);

    // FX curve: flat 1/1.09 for weekdays in range.
    const today = Date.now();
    const fxDates: string[] = [];
    for (
      let t = new Date("2026-01-05T12:00:00Z").getTime();
      t <= new Date("2026-02-05T12:00:00Z").getTime();
      t += 86_400_000
    ) {
      const d = new Date(t);
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
      const iso = d.toISOString().slice(0, 10);
      fxDates.push(iso);
      db
        .insert(schema.fxRates)
        .values({
          id: ulid(),
          currency: "USD",
          date: iso,
          rateToEur: 1 / 1.09,
          source: "yahoo-fx",
          createdAt: today,
        })
        .run();
    }

    db.transaction((tx) => {
      rebuildValuationsForAsset(tx, assetId);
    });

    const vals = db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, assetId))
      .orderBy(asc(schema.assetValuations.valuationDate))
      .all();

    // Only weekdays from first trade onwards (the rebuild walks to today
    // — not just the seeded FX range — since `lastFx` carries forward).
    expect(vals.length).toBeGreaterThan(fxDates.length - 1);
    for (const v of vals) {
      const day = new Date(`${v.valuationDate}T12:00:00Z`).getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }

    // 310 USD × 2 × (1/1.09) ≈ 568.81
    const first = vals[0];
    expect(first.marketValueEur).toBeCloseTo((2 * 310) / 1.09, 1);
  });

  it("emits rows every day (weekends included) for crypto assets", async () => {
    const assetId = ulid();
    const now = Date.now();
    db
      .insert(schema.assets)
      .values({
        id: assetId,
        name: "Bitcoin",
        assetType: "crypto",
        symbol: "BTC",
        providerSymbol: "bitcoin",
        currency: "EUR",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    insertBuy(db, assetId, accountId, "2026-01-05", 0.1, 40000, 1, "EUR");
    seedPriceHistory(db, "bitcoin", "2026-01-05", "2026-01-20", 45000, {
      weekdaysOnly: false,
    });

    db.transaction((tx) => {
      rebuildValuationsForAsset(tx, assetId);
    });

    const vals = db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, assetId))
      .all();

    // Spans at least two weekends, so weekend days must appear.
    const weekendCount = vals.filter((v) => {
      const d = new Date(`${v.valuationDate}T12:00:00Z`).getUTCDay();
      return d === 0 || d === 6;
    }).length;
    expect(weekendCount).toBeGreaterThan(0);
    // Market value flat at 45000 × 0.1 = 4500 €.
    expect(vals[0].marketValueEur).toBeCloseTo(4500, 1);
  });

  it("is idempotent — re-running wipes and repopulates without drift", async () => {
    const assetId = ulid();
    const now = Date.now();
    db
      .insert(schema.assets)
      .values({
        id: assetId,
        name: "VWCE",
        assetType: "etf",
        symbol: "VWCE",
        providerSymbol: "VWCE",
        currency: "EUR",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    insertBuy(db, assetId, accountId, "2026-01-05", 4, 120, 1, "EUR");
    seedPriceHistory(db, "VWCE", "2026-01-05", "2026-02-05", 125);

    db.transaction((tx) => rebuildValuationsForAsset(tx, assetId));
    const first = db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, assetId))
      .all();

    db.transaction((tx) => rebuildValuationsForAsset(tx, assetId));
    const second = db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, assetId))
      .all();

    expect(second.length).toBe(first.length);
    const projection = (rows: typeof first) =>
      rows
        .map((r) => `${r.valuationDate}|${r.marketValueEur.toFixed(2)}`)
        .sort();
    expect(projection(second)).toEqual(projection(first));
  });
});

// Audit P1: the windowed (incremental) rebuild must produce exactly the same
// rows as a full rebuild for the same ledger.
describe("incremental valuation rebuild equivalence", () => {
  it("rebuild from a mid-series date equals a full rebuild", () => {
    const db = makeDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(schema.accounts).values({
      id: accountId, name: "B", currency: "EUR", accountType: "broker",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(schema.assets).values({
      id: assetId, name: "VWCE", assetType: "equity", symbol: "VWCE",
      currency: "EUR", isActive: true, assetClassTax: "etf",
    }).run();

    const mk = (type: "buy" | "sell", qty: number, iso: string) => {
      const gross = qty * 100;
      db.insert(schema.assetTransactions).values({
        id: ulid(), accountId, assetId,
        transactionType: type, tradedAt: new Date(`${iso}T12:00:00Z`).getTime(),
        quantity: qty, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
        tradeGrossAmount: gross, tradeGrossAmountEur: gross,
        cashImpactEur: type === "buy" ? -gross : gross,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: type === "buy" ? -gross : gross,
        isListed: true, source: "manual",
      }).run();
    };
    mk("buy", 10, "2026-01-05");
    mk("buy", 5, "2026-02-10");
    mk("sell", 8, "2026-03-12");
    seedPriceHistory(db, "VWCE", "2026-01-02", "2026-06-01", (i) => 100 + i);

    const snapshot = () =>
      db
        .select({
          valuationDate: schema.assetValuations.valuationDate,
          quantity: schema.assetValuations.quantity,
          unitPriceEur: schema.assetValuations.unitPriceEur,
          marketValueEur: schema.assetValuations.marketValueEur,
        })
        .from(schema.assetValuations)
        .all()
        .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate));

    // Full rebuild = reference.
    db.transaction((tx) => { rebuildValuationsForAsset(tx as unknown as DB, assetId); });
    const full = snapshot();
    expect(full.length).toBeGreaterThan(50);

    // Corrupt the tail, then rebuild incrementally from the March trade date.
    db.transaction((tx) => { rebuildValuationsForAsset(tx as unknown as DB, assetId, "2026-03-12"); });
    const incremental = snapshot();
    expect(incremental).toStrictEqual(full);

    // Incremental from a date before the first trade is also identical.
    db.transaction((tx) => { rebuildValuationsForAsset(tx as unknown as DB, assetId, "2025-12-01"); });
    expect(snapshot()).toStrictEqual(full);
  });
});
