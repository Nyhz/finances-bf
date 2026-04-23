import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { makeDb } from "./_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAccount } from "../../actions/accounts";
import { createAsset } from "../../actions/createAsset";
import { syncPrices } from "../../lib/price-sync";
import { ulid } from "ulid";

describe("e2e — cron price sync (syncPrices)", () => {
  let db: DB;

  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      {
        name: "DEGIRO",
        accountType: "investment",
        currency: "EUR",
        openingBalanceNative: 0,
      },
      db,
    );
    if (!acc.ok) throw new Error("account");

    const asmlRes = await createAsset(
      {
        name: "ASML HOLDING",
        assetType: "stock",
        isin: "NL0010273215",
        symbol: "ASML",
        currency: "EUR",
        providerSymbol: "ASML.AS",
      },
      db,
    );
    if (!asmlRes.ok) throw new Error("asml");
    const aaplRes = await createAsset(
      {
        name: "APPLE INC",
        assetType: "stock",
        isin: "US0378331005",
        symbol: "AAPL",
        currency: "USD",
        providerSymbol: "AAPL",
      },
      db,
    );
    if (!aaplRes.ok) throw new Error("aapl");

    // Seed positions so sync has something to value.
    const now = Date.now();
    db
      .insert(schema.assetPositions)
      .values({
        id: ulid(),
        assetId: asmlRes.data.id,
        quantity: 10,
        averageCost: 650,
        averageCostNative: 650,
        totalCostNative: 6500,
        totalCostEur: 6500,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db
      .insert(schema.assetPositions)
      .values({
        id: ulid(),
        assetId: aaplRes.data.id,
        quantity: 5,
        averageCost: 170,
        averageCostNative: 185,
        totalCostNative: 925,
        totalCostEur: 850,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  it("fetches Yahoo quotes, stores price_history, fx_rates and today's asset_valuations", async () => {
    const yahooCalls: string[] = [];
    const yahoo = {
      fetchQuote: vi.fn(async (symbol: string) => {
        yahooCalls.push(symbol);
        if (symbol === "ASML.AS")
          return { symbol, price: 720, currency: "EUR", asOf: new Date() };
        if (symbol === "AAPL")
          return { symbol, price: 200, currency: "USD", asOf: new Date() };
        if (symbol === "EURUSD=X")
          // 1 EUR = 1.10 USD → rateToEur = 1/1.10 = 0.909090…
          return {
            symbol,
            price: 1.1,
            currency: "USD",
            asOf: new Date(),
          };
        throw new Error(`unexpected yahoo fetch: ${symbol}`);
      }),
    };
    const coingecko = {
      fetchQuote: vi.fn(async () => {
        throw new Error("no crypto assets in this test");
      }),
    };

    const summary = await syncPrices(db, { yahoo, coingecko });
    expect(summary.errors).toEqual([]);
    expect(summary.fetched).toBe(2); // ASML + AAPL
    expect(summary.fxFetched).toBeGreaterThan(0); // USD rate fetched

    // price_history rows persisted for today.
    const prices = db.select().from(schema.priceHistory).all();
    expect(prices.length).toBeGreaterThanOrEqual(2);
    expect(prices.find((p) => p.symbol === "ASML.AS")?.price).toBe(720);
    expect(prices.find((p) => p.symbol === "AAPL")?.price).toBe(200);

    // fx_rates populated for USD.
    const usd = db
      .select()
      .from(schema.fxRates)
      .where(eq(schema.fxRates.currency, "USD"))
      .get();
    expect(usd).toBeDefined();
    expect(usd?.rateToEur).toBeCloseTo(1 / 1.1, 4);

    // Valuation rows written for today.
    const today = new Date().toISOString().slice(0, 10);
    const todayVals = db
      .select()
      .from(schema.assetValuations)
      .where(eq(schema.assetValuations.valuationDate, today))
      .all();
    expect(todayVals.length).toBe(2);

    // AAPL valuation in EUR: 200 USD × 5 × (1/1.10) ≈ 909.09 €.
    const aaplAsset = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.symbol, "AAPL"))
      .get();
    const aaplVal = db
      .select()
      .from(schema.assetValuations)
      .where(
        and(
          eq(schema.assetValuations.assetId, aaplAsset!.id),
          eq(schema.assetValuations.valuationDate, today),
        ),
      )
      .get();
    expect(aaplVal?.marketValueEur).toBeCloseTo(5 * 200 * (1 / 1.1), 1);
  });
});
