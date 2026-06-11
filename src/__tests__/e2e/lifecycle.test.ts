import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { clearFx, makeDb, seedPriceHistory } from "./_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAccount } from "../../actions/accounts";
import { createAsset } from "../../actions/createAsset";
import { createTransaction } from "../../actions/createTransaction";
import { deleteTransaction } from "../../actions/deleteTransaction";
import { wipeApp } from "../../actions/wipeApp";

async function setup(db: DB) {
  const acc = await createAccount(
    {
      name: "BINANCE",
      accountType: "crypto",
      currency: "EUR",
      openingBalanceNative: 0,
    },
    db,
  );
  if (!acc.ok) throw new Error("account");
  const asset = await createAsset(
    {
      name: "Bitcoin",
      assetType: "crypto",
      symbol: "BTC",
      currency: "EUR",
      providerSymbol: "bitcoin",
    },
    db,
  );
  if (!asset.ok) throw new Error("asset");
  seedPriceHistory(db, "bitcoin", "2026-01-10", "2026-04-22", 45000, {
    weekdaysOnly: false,
  });
  return { accountId: acc.data.id, assetId: asset.data.id };
}

describe("e2e — lifecycle: deleteTransaction / wipeApp", () => {
  let db: DB;
  let accountId: string;
  let assetId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();
    ({ accountId, assetId } = await setup(db));
    const buy = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-01-10",
        side: "buy",
        quantity: 0.1,
        priceNative: 40_000,
        currency: "EUR",
        fees: 0,
      },
      db,
    );
    if (!buy.ok) throw new Error(buy.error.message);
    const sell = await createTransaction(
      {
        accountId,
        assetId,
        tradeDate: "2026-02-20",
        side: "sell",
        quantity: 0.05,
        priceNative: 40_000,
        currency: "EUR",
        fees: 0,
      },
      db,
    );
    if (!sell.ok) throw new Error(sell.error.message);
  });

  it("deleteTransaction recomputes positions, lots and valuations; never touches asset catalog or price_history", async () => {
    const trades = db.select().from(schema.assetTransactions).all();
    expect(trades).toHaveLength(2);

    // Delete the SELL — should restore the full 0.1 BTC position.
    const sell = trades.find((t) => t.transactionType === "sell")!;
    const del = await deleteTransaction({ id: sell.id }, db);
    if (!del.ok) throw new Error(del.error.message);

    const positions = db.select().from(schema.assetPositions).all();
    expect(positions[0].quantity).toBeCloseTo(0.1, 6);

    // Lot for the original buy is now fully open again (recomputed from scratch).
    const lots = db.select().from(schema.taxLots).all();
    expect(lots).toHaveLength(1);
    expect(lots[0].remainingQty).toBeCloseTo(0.1, 6);

    // Asset catalog + price_history preserved.
    expect(db.select().from(schema.assets).all()).toHaveLength(1);
    expect(
      db.select().from(schema.priceHistory).all().length,
    ).toBeGreaterThan(0);
  });

  it("wipeApp requires 'WIPE' confirmation and keeps ONLY assets + price_history", async () => {
    // Bad confirmation → validation error, nothing touched.
    const bad = await wipeApp({ confirmation: "nope" }, db);
    expect(bad.ok).toBe(false);
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(2);

    const res = await wipeApp({ confirmation: "WIPE" }, db);
    if (!res.ok) throw new Error(res.error.message);

    // Kept.
    expect(db.select().from(schema.assets).all().length).toBeGreaterThan(0);
    expect(
      db.select().from(schema.priceHistory).all().length,
    ).toBeGreaterThan(0);

    // Everything else zero.
    expect(db.select().from(schema.accounts).all()).toHaveLength(0);
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(0);
    expect(db.select().from(schema.accountCashMovements).all()).toHaveLength(0);
    expect(db.select().from(schema.assetPositions).all()).toHaveLength(0);
    expect(db.select().from(schema.assetValuations).all()).toHaveLength(0);
    expect(db.select().from(schema.dailyBalances).all()).toHaveLength(0);
    expect(db.select().from(schema.taxLots).all()).toHaveLength(0);
    expect(db.select().from(schema.taxLotConsumptions).all()).toHaveLength(0);
    expect(
      db.select().from(schema.taxWashSaleAdjustments).all(),
    ).toHaveLength(0);
    expect(db.select().from(schema.taxYearSnapshots).all()).toHaveLength(0);
    expect(db.select().from(schema.auditEvents).all()).toHaveLength(0);
    expect(db.select().from(schema.fxRates).all()).toHaveLength(0);
  });
});
