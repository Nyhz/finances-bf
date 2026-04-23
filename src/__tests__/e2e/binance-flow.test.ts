import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  clearFx,
  makeDb,
  mkFxBars,
  resolveFxRangeStub,
  seedPriceHistory,
  setFx,
} from "./_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../lib/fx-backfill", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/fx-backfill")>(
      "../../lib/fx-backfill",
    );
  return { ...actual, resolveFxRange: resolveFxRangeStub };
});

import { createAccount } from "../../actions/accounts";
import { createAsset } from "../../actions/createAsset";
import { confirmImport } from "../../actions/confirmImport";

function seedAssets(db: DB) {
  return Promise.all([
    createAsset(
      {
        name: "Bitcoin",
        assetType: "crypto",
        symbol: "BTC",
        currency: "EUR",
        providerSymbol: "bitcoin",
      },
      db,
    ),
    createAsset(
      {
        name: "Ethereum",
        assetType: "crypto",
        symbol: "ETH",
        currency: "EUR",
        providerSymbol: "ethereum",
      },
      db,
    ),
    createAsset(
      {
        name: "Solana",
        assetType: "crypto",
        symbol: "SOL",
        currency: "EUR",
        providerSymbol: "solana",
      },
      db,
    ),
    createAsset(
      {
        name: "Tether",
        assetType: "crypto",
        symbol: "USDT",
        currency: "EUR",
        providerSymbol: "tether",
      },
      db,
    ),
  ]);
}

describe("e2e — Binance import", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();
    const acc = await createAccount(
      {
        name: "BINANCE",
        accountType: "crypto",
        currency: "EUR",
        openingBalanceNative: 0,
      },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    accountId = acc.data.id;
    await seedAssets(db);
  });

  it("imports EUR-quoted trades as single-leg (plain buy/sell)", async () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-01-10 10:00:00,BTCEUR,BUY,40000,0.1,4000,0,EUR\n" +
      "2026-02-20 10:00:00,BTCEUR,SELL,45000,0.05,2250,0,EUR\n";
    seedPriceHistory(db, "bitcoin", "2026-01-10", "2026-04-22", 45000, {
      weekdaysOnly: false,
    });

    const res = await confirmImport(
      { source: "binance", accountId, csvText: csv },
      db,
    );
    if (!res.ok) throw new Error(res.error.message);

    const trades = db.select().from(schema.assetTransactions).all();
    expect(trades).toHaveLength(2);
    expect(trades.every((t) => t.tradeCurrency === "EUR")).toBe(true);

    // Remaining BTC = 0.05, realised gain on the 0.05 sold: (45000−40000) × 0.05 = 250 €.
    const btc = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.symbol, "BTC"))
      .get();
    const pos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, btc!.id))
      .get();
    expect(pos?.quantity).toBeCloseTo(0.05, 6);
    const lots = db
      .select()
      .from(schema.taxLots)
      .where(eq(schema.taxLots.assetId, btc!.id))
      .all();
    expect(lots).toHaveLength(1);
    expect(lots[0].remainingQty).toBeCloseTo(0.05, 6);
    const consumptions = db
      .select()
      .from(schema.taxLotConsumptions)
      .all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].qtyConsumed).toBeCloseTo(0.05, 6);
    expect(consumptions[0].costBasisEur).toBeCloseTo(2000, 2);
  });

  it("emits both legs for a crypto-crypto permuta (ETHBTC BUY → +ETH, -BTC)", async () => {
    // Seed a BTC buy first so the mirror leg has a lot to consume.
    const setupCsv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-01-01 10:00:00,BTCEUR,BUY,40000,0.1,4000,0,EUR\n";
    const swapCsv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-03-01 10:00:00,ETHBTC,BUY,0.058,0.5,0.029,0,BTC\n";

    seedPriceHistory(db, "bitcoin", "2026-01-01", "2026-04-22", 45000, {
      weekdaysOnly: false,
    });
    seedPriceHistory(db, "ethereum", "2026-01-01", "2026-04-22", 2600, {
      weekdaysOnly: false,
    });
    // FX EUR/BTC resolved via CoinGecko-style rate (1 BTC = 45000 EUR).
    setFx("BTC", mkFxBars("2026-01-01", "2026-04-22", 45000), "coingecko-fx");

    const r1 = await confirmImport(
      { source: "binance", accountId, csvText: setupCsv },
      db,
    );
    if (!r1.ok) throw new Error(r1.error.message);

    const r2 = await confirmImport(
      { source: "binance", accountId, csvText: swapCsv },
      db,
    );
    if (!r2.ok) throw new Error(r2.error.message);

    const trades = db.select().from(schema.assetTransactions).all();
    // setup: 1 trade; swap: 2 legs; total 3.
    expect(trades).toHaveLength(3);

    const btc = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.symbol, "BTC"))
      .get();
    const eth = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.symbol, "ETH"))
      .get();

    // BTC position after swap: 0.1 − 0.029 = 0.071.
    const btcPos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, btc!.id))
      .get();
    expect(btcPos?.quantity).toBeCloseTo(0.071, 6);

    // ETH position after swap: +0.5.
    const ethPos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, eth!.id))
      .get();
    expect(ethPos?.quantity).toBeCloseTo(0.5, 6);
    // ETH cost basis = 0.029 BTC × 45000 EUR/BTC = 1305 €.
    expect(ethPos?.totalCostEur).toBeCloseTo(1305, 1);

    // BTC consumption realises gain vs original cost basis:
    //   proceeds = 0.029 × 45000 = 1305 €
    //   cost    = 0.029 × 40000 = 1160 €
    //   gain    = 145 €
    const btcConsumptions = db
      .select()
      .from(schema.taxLotConsumptions)
      .all();
    expect(btcConsumptions).toHaveLength(1);
    expect(btcConsumptions[0].costBasisEur).toBeCloseTo(1160, 0);
  });

  it("aborts atomically when the permuta would oversell an untracked asset", async () => {
    // Importing SOLUSDT BUY without any prior USDT lot: the mirror leg
    // (sell USDT) has nothing to consume → recomputeLotsForAsset throws
    // 'oversells' → entire tx rolls back, DB stays clean.
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-02-18 21:03:44,SOLUSDT,BUY,95.40,10,954,0,SOL\n";
    seedPriceHistory(db, "solana", "2026-02-01", "2026-04-22", 100, {
      weekdaysOnly: false,
    });
    setFx("USDT", mkFxBars("2026-02-01", "2026-04-22", 0.92), "coingecko-fx");

    const res = await confirmImport(
      { source: "binance", accountId, csvText: csv },
      db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/oversells/);
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(0);
    expect(db.select().from(schema.taxLots).all()).toHaveLength(0);
    expect(db.select().from(schema.fxRates).all()).toHaveLength(0);
  });

  it("does not import Binance fees (dust policy)", async () => {
    const csv =
      "Date(UTC),Pair,Side,Price,Executed,Amount,Fee,Fee Coin\n" +
      "2026-01-10 10:00:00,BTCEUR,BUY,40000,0.1,4000,0.00015,BNB\n";
    seedPriceHistory(db, "bitcoin", "2026-01-10", "2026-04-22", 45000, {
      weekdaysOnly: false,
    });

    const res = await confirmImport(
      { source: "binance", accountId, csvText: csv },
      db,
    );
    if (!res.ok) throw new Error(res.error.message);

    const trades = db.select().from(schema.assetTransactions).all();
    expect(trades).toHaveLength(1);
    expect(trades[0].feesAmount).toBe(0);
    expect(trades[0].feesAmountEur).toBe(0);
  });
});
