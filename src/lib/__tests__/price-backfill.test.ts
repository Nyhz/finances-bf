import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  backfillCryptoPrices,
  backfillFundPrices,
  backfillFundValuations,
  type BackfillClient,
} from "../price-backfill";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function client(bars: Record<string, Array<{ date: string; close: number }>>): BackfillClient {
  return {
    fetchHistory: vi.fn(async (symbol: string) => {
      const rows = bars[symbol] ?? [];
      return rows.map((r) => ({ ...r, currency: "EUR" }));
    }),
  };
}

describe("backfillCryptoPrices", () => {
  let db: DB;
  const today = "2026-04-18";

  beforeEach(() => {
    db = makeDb();
  });

  it("returns an empty summary when no crypto assets exist", async () => {
    const summary = await backfillCryptoPrices(db, client({}), today);
    expect(summary).toEqual({ date: today, assets: [] });
  });

  it("flags crypto assets without a providerSymbol and keeps going", async () => {
    await db.insert(schema.assets).values({
      id: "ast_bnb",
      name: "BNB",
      assetType: "crypto",
      symbol: "BNB",
      providerSymbol: null,
      currency: "EUR",
      isActive: true,
    }).run();
    const summary = await backfillCryptoPrices(db, client({}), today);
    expect(summary.assets).toHaveLength(1);
    expect(summary.assets[0].error).toMatch(/providerSymbol/);
  });

  it("inserts missing bars and skips ones already present (idempotent)", async () => {
    await db.insert(schema.accounts).values({
      id: "acct_1",
      name: "Binance Spot",
      accountType: "crypto",
      currency: "EUR",
    }).run();
    await db.insert(schema.assets).values({
      id: "ast_eth",
      name: "Ethereum",
      assetType: "crypto",
      symbol: "ETH",
      providerSymbol: "ethereum",
      currency: "EUR",
      isActive: true,
    }).run();
    // Ensure there's at least one trade so the backfill has a from-date.
    await db.insert(schema.assetTransactions).values({
      id: "tx_eth",
      accountId: "acct_1",
      assetId: "ast_eth",
      transactionType: "buy",
      tradedAt: new Date("2026-01-10T12:00:00Z").getTime(),
      quantity: 0.1,
      unitPrice: 3000,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: 300,
      tradeGrossAmountEur: 300,
      cashImpactEur: -300,
      netAmountEur: -300,
      rowFingerprint: "fp_eth",
      source: "manual",
    }).run();
    // Seed an existing row for one of the bars to prove idempotency.
    await db.insert(schema.priceHistory).values({
      id: "ph_existing",
      symbol: "ethereum",
      price: 3050,
      pricedAt: new Date("2026-01-12T00:00:00Z").getTime(),
      pricedDateUtc: "2026-01-12",
      source: "coingecko",
    }).run();

    const c = client({
      ethereum: [
        { date: "2026-01-10", close: 3000 },
        { date: "2026-01-11", close: 3100 },
        { date: "2026-01-12", close: 3200 }, // already present → skipped
      ],
    });
    const summary = await backfillCryptoPrices(db, c, today);
    expect(summary.assets).toHaveLength(1);
    expect(summary.assets[0]).toMatchObject({
      assetId: "ast_eth",
      providerSymbol: "ethereum",
      bars: 3,
      inserted: 2,
      skipped: 1,
    });

    const rows = await db.select().from(schema.priceHistory).all();
    expect(rows).toHaveLength(3);
    // Existing row was not overwritten (still price 3050).
    const twelfth = rows.find((r) => r.pricedDateUtc === "2026-01-12");
    expect(twelfth?.price).toBe(3050);

    // Second run inserts nothing new.
    const again = await backfillCryptoPrices(db, c, today);
    expect(again.assets[0].inserted).toBe(0);
    expect(again.assets[0].skipped).toBe(3);
  });

  it("skips crypto assets with no trades yet", async () => {
    await db.insert(schema.assets).values({
      id: "ast_solana",
      name: "Solana",
      assetType: "crypto",
      symbol: "SOL",
      providerSymbol: "solana",
      currency: "EUR",
      isActive: true,
    }).run();
    const summary = await backfillCryptoPrices(db, client({}), today);
    expect(summary.assets[0].error).toMatch(/no trades/);
  });
});

describe("backfillFundPrices / backfillFundValuations (FT)", () => {
  let db: DB;
  const today = "2026-04-18";

  beforeEach(() => {
    db = makeDb();
  });

  async function seedFund() {
    await db.insert(schema.accounts).values({
      id: "acct_mi",
      name: "MyInvestor",
      accountType: "investment",
      currency: "EUR",
    }).run();
    await db.insert(schema.assets).values({
      id: "ast_grp",
      name: "Groupama Trésorerie IC",
      assetType: "fund",
      symbol: "GROUPAMA",
      isin: "FR0000989626",
      priceSource: "ft",
      currency: "EUR",
      isActive: true,
    }).run();
    await db.insert(schema.assetTransactions).values({
      id: "tx_grp",
      accountId: "acct_mi",
      assetId: "ast_grp",
      transactionType: "buy",
      tradedAt: new Date("2026-01-15T10:00:00Z").getTime(),
      quantity: 2,
      unitPrice: 44100,
      tradeCurrency: "EUR",
      fxRateToEur: 1,
      tradeGrossAmount: 88200,
      tradeGrossAmountEur: 88200,
      cashImpactEur: -88200,
      netAmountEur: -88200,
      rowFingerprint: "fp_grp",
      source: "manual",
    }).run();
  }

  it("inserts FT bars keyed by ISIN:CURRENCY with source 'ft'", async () => {
    await seedFund();
    const c = client({
      "FR0000989626:EUR": [
        { date: "2026-01-14", close: 44000 },
        { date: "2026-01-15", close: 44100 },
        { date: "2026-01-16", close: 44200 },
      ],
    });
    const summary = await backfillFundPrices(db, c, today);
    expect(summary.assets).toHaveLength(1);
    expect(summary.assets[0]).toMatchObject({
      assetId: "ast_grp",
      providerSymbol: "FR0000989626:EUR",
      bars: 3,
      inserted: 3,
      skipped: 0,
    });
    const rows = await db.select().from(schema.priceHistory).all();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "ft")).toBe(true);
    expect(rows.every((r) => r.symbol === "FR0000989626:EUR")).toBe(true);
  });

  it("honours an explicit `from` override (backfill before the first trade)", async () => {
    await seedFund();
    const c = client({ "FR0000989626:EUR": [{ date: "2025-06-01", close: 43000 }] });
    await backfillFundPrices(db, c, today, {
      from: new Date("2025-06-01T00:00:00Z"),
    });
    // The client received the overridden from-date, not the asset's first trade.
    const call = (c.fetchHistory as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[1] as Date).toISOString()).toBe("2025-06-01T00:00:00.000Z");
  });

  it("values only days held with a real NAV — no row on unheld days, no carry-forward", async () => {
    await seedFund();
    const c = client({
      "FR0000989626:EUR": [
        { date: "2026-01-14", close: 44000 }, // pre-purchase → NOT held → no row
        { date: "2026-01-15", close: 44100 }, // bought 2 here
        { date: "2026-01-16", close: 44200 },
      ],
    });
    await backfillFundPrices(db, c, today);
    await backfillFundValuations(db, today);

    const vals = await db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, "ast_grp"))
      .all();
    const byDate = Object.fromEntries(vals.map((v) => [v.valuationDate, v]));
    // Unheld day gets no valuation at all (not a zero row).
    expect(byDate["2026-01-14"]).toBeUndefined();
    expect(byDate["2026-01-15"].marketValueEur).toBe(88200);
    expect(byDate["2026-01-16"].unitPriceEur).toBe(44200);
    expect(byDate["2026-01-16"].priceSource).toBe("ft");
    // No extra carried-forward rows beyond the last real NAV bar (01-16).
    expect(vals.length).toBe(2);
  });

  it("emits zero valuations when no held day has a NAV yet (bought after last NAV)", async () => {
    await seedFund(); // buy on 2026-01-15
    const c = client({
      // Only NAVs BEFORE the purchase exist (the T+1 lag on purchase day).
      "FR0000989626:EUR": [
        { date: "2026-01-13", close: 43900 },
        { date: "2026-01-14", close: 44000 },
      ],
    });
    await backfillFundPrices(db, c, today);
    await backfillFundValuations(db, today);
    const vals = await db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.assetId, "ast_grp"))
      .all();
    expect(vals.length).toBe(0);
  });
});

describe("cron backfill-prices route", () => {
  it("rejects without the CRON_SECRET header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { GET } = await import("../../app/api/cron/backfill-prices/route");
    const res = await GET(
      new Request("http://localhost/api/cron/backfill-prices"),
    );
    expect(res.status).toBe(401);
  });
});
