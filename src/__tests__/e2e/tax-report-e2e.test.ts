import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { clearFx, makeDb, mkFxBars, seedPriceHistory } from "./_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAccount } from "../../actions/accounts";
import { createAsset } from "../../actions/createAsset";
import { createTransaction } from "../../actions/createTransaction";
import { createDividend } from "../../actions/createDividend";
import { buildTaxReport } from "../../server/tax/report";

// Mixed full-year story (manual entry — the only registration path):
//   - VWCE: buy 4 @ 120 EUR → held (no realised gain).
//   - AAPL: buy 5 @ 185.20 USD → partial sell 2 @ 192 USD → small gain.
//   - UNH: dividend with origin withholding → surfaces in the dividend
//     section with EUR withholding credit.
// Fees are EUR (European broker) per project rule.

function seedFxRates(db: DB, ccy: string, fromIso: string, toIso: string, rate: number) {
  const now = Date.now();
  for (const bar of mkFxBars(fromIso, toIso, rate, { weekdaysOnly: false })) {
    db.insert(schema.fxRates).values({
      id: ulid(),
      currency: ccy,
      date: bar.iso,
      rateToEur: bar.rateToEur,
      source: "yahoo_fx",
      createdAt: now,
    }).run();
  }
}

describe("e2e — tax report (end-of-year, realised gains + dividends)", () => {
  let db: DB;
  let accountId: string;
  let vwceId: string;
  let aaplId: string;
  let unhId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();
    seedFxRates(db, "USD", "2026-01-01", "2026-04-22", 0.923);
    seedPriceHistory(db, "VWCE", "2026-01-02", "2026-04-22", 125);
    seedPriceHistory(db, "AAPL", "2026-02-05", "2026-04-22", 200);
    seedPriceHistory(db, "UNH", "2026-03-18", "2026-04-22", 310);

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
    accountId = acc.data.id;

    const mkAsset = async (input: Parameters<typeof createAsset>[0]) => {
      const res = await createAsset(input, db);
      if (!res.ok) throw new Error("asset");
      return res.data.id;
    };
    vwceId = await mkAsset({
      name: "VANGUARD FTSE ALL-WORLD",
      assetType: "etf",
      isin: "IE00BK5BQT80",
      symbol: "VWCE",
      currency: "EUR",
      providerSymbol: "VWCE",
    });
    aaplId = await mkAsset({
      name: "APPLE INC",
      assetType: "stock",
      isin: "US0378331005",
      symbol: "AAPL",
      currency: "USD",
      providerSymbol: "AAPL",
    });
    unhId = await mkAsset({
      name: "UNITEDHEALTH GROUP INC",
      assetType: "stock",
      isin: "US91324P1021",
      symbol: "UNH",
      currency: "USD",
      providerSymbol: "UNH",
    });
  });

  it("registers a mixed year manually and builds a consistent tax report", async () => {
    const trade = async (input: Parameters<typeof createTransaction>[0]) => {
      const res = await createTransaction(input, db);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    };

    await trade({
      accountId,
      assetId: vwceId,
      tradeDate: "2026-01-02",
      side: "buy",
      quantity: 4,
      priceNative: 120,
      currency: "EUR",
      fees: 1,
    });
    // FX is always manual, in the broker's direction: 1 EUR = 1/0.923 USD.
    await trade({
      accountId,
      assetId: aaplId,
      tradeDate: "2026-02-05",
      side: "buy",
      quantity: 5,
      priceNative: 185.2,
      currency: "USD",
      fxEurToCcy: 1 / 0.923,
      fees: 0.46,
    });
    await trade({
      accountId,
      assetId: aaplId,
      tradeDate: "2026-03-12",
      side: "sell",
      quantity: 2,
      priceNative: 192,
      currency: "USD",
      fxEurToCcy: 1 / 0.923,
      fees: 0.46,
    });

    const div = await createDividend(
      {
        accountId,
        assetId: unhId,
        tradeDate: "2026-03-18",
        grossNative: 6.63,
        currency: "USD",
        fxEurToCcy: 1 / 0.923,
        withholdingOrigenNative: 0.99,
        sourceCountry: "US",
      },
      db,
    );
    if (!div.ok) throw new Error(div.error.message);

    const report = buildTaxReport(db, 2026);

    // Exactly one AAPL sell landed in the report.
    expect(report.sales).toHaveLength(1);
    const sale = report.sales[0];

    // Proceeds: 2 × 192 USD × 0.923 = 354.43 €.
    expect(sale.proceedsEur).toBeCloseTo(354.43, 2);

    // Cost basis for 2 of 5 AAPL: (854.70 + 0.46) × 2/5 = 342.06 €.
    expect(sale.costBasisEur).toBeCloseTo(342.06, 2);

    // Computable gain: proceeds − cost − sale fee = 354.43 − 342.06 − 0.46.
    expect(sale.computableGainLossEur).toBeCloseTo(11.91, 2);

    // Dividend section picks up the UNH payment with origin withholding
    // converted at the stored daily rate.
    expect(report.dividends).toHaveLength(1);
    const d = report.dividends[0];
    expect(d.sourceCountry).toBe("US");
    expect(d.grossEur).toBeCloseTo(6.63 * 0.923, 2);
    expect(d.withholdingOrigenEur).toBeCloseTo(0.99 * 0.923, 2);

    // Position on VWCE still held.
    const vwcePos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, vwceId))
      .get();
    expect(vwcePos?.quantity).toBeCloseTo(4, 6);

    // Totals sanity.
    expect(report.totals.netComputableEur).toBeCloseTo(11.91, 2);
  });
});
