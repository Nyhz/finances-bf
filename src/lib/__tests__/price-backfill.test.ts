import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  backfillCryptoPrices,
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
