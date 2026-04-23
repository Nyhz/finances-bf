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

// DEGIRO statement CSV with a mix of:
//   - EUR trade  (VWCE buy)
//   - USD trade  (UNH buy) with matching "Retirada Cambio de Divisa" → fxRateToEurOverride
//   - USD dividend with origin withholding (WHT) from UNH
//   - USD cash movements (Ingreso/Retirada cambio de divisa)
const CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
05-01-2026,10:00,05-01-2026,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,"Compra 4 Vanguard FTSE All-World@120,00 EUR (IE00BK5BQT80)",,EUR,"-480,00",EUR,"-480,00",ord-vwce-1
05-01-2026,10:00,05-01-2026,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,Costes de transacción,,EUR,"-1,00",EUR,"-481,00",ord-vwce-1
15-02-2026,10:00,15-02-2026,UNITEDHEALTH GROUP INC,US91324P1021,"Compra 2 UnitedHealth Group Inc@300,00 USD (US91324P1021)",,USD,"-600,00",USD,"-600,00",ord-unh-1
15-02-2026,10:00,15-02-2026,UNITEDHEALTH GROUP INC,US91324P1021,Costes de transacción,,USD,"-0,50",USD,"-600,50",ord-unh-1
15-02-2026,10:05,15-02-2026,,,Retirada Cambio de Divisa,"1,0900",USD,"600,50",USD,"0,00",
15-02-2026,10:05,15-02-2026,,,Ingreso Cambio de Divisa,,EUR,"-550,92",EUR,"-1031,92",
18-03-2026,07:02,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Retención del dividendo,,USD,"-0,99",USD,"-0,99",
18-03-2026,07:03,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"6,63",USD,"5,64",
19-03-2026,06:40,18-03-2026,,,Retirada Cambio de Divisa,"1,0905",USD,"-5,64",USD,"0,00",
19-03-2026,06:40,18-03-2026,,,Ingreso Cambio de Divisa,,EUR,"5,17",EUR,"-1026,75",
`;

describe("e2e — DEGIRO statement import", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();
    // Register USD FX bars covering the trade window.
    setFx("USD", mkFxBars("2026-01-01", "2026-03-31", 0.9174));
    // Seed a modest price_history feed so valuation rebuild has bars to read.
    seedPriceHistory(db, "VWCE", "2026-01-05", "2026-04-01", 122);
    seedPriceHistory(db, "UNH", "2026-02-15", "2026-04-01", 310);

    const acc = await createAccount(
      {
        name: "DEGIRO",
        accountType: "investment",
        currency: "EUR",
        openingBalanceNative: 0,
      },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    accountId = acc.data.id;

    // Pre-register assets with matching symbols so the import reuses them
    // and `rebuildValuationsForAsset` can find their price history.
    const vwceRes = await createAsset(
      {
        name: "VANGUARD FTSE ALL-WORLD",
        assetType: "etf",
        isin: "IE00BK5BQT80",
        symbol: "VWCE",
        currency: "EUR",
        providerSymbol: "VWCE",
      },
      db,
    );
    if (!vwceRes.ok) throw new Error("vwce seed");
    const unhRes = await createAsset(
      {
        name: "UNITEDHEALTH GROUP INC",
        assetType: "stock",
        isin: "US91324P1021",
        symbol: "UNH",
        currency: "USD",
        providerSymbol: "UNH",
      },
      db,
    );
    if (!unhRes.ok) throw new Error("unh seed");
  });

  it("imports trades, creates assets, computes positions, lots, FX and valuations", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error(`confirmImport failed: ${res.error.message}`);

    // Trades: VWCE buy + UNH buy + UNH dividend.
    const trades = db.select().from(schema.assetTransactions).all();
    const buys = trades.filter((t) => t.transactionType === "buy");
    const dividends = trades.filter((t) => t.transactionType === "dividend");
    expect(buys).toHaveLength(2);
    expect(dividends).toHaveLength(1);

    // UNH buy carries the broker's real FX rate (0.9174) from the "Retirada
    // Cambio de Divisa" line — NOT the mock mid-market rate — because the
    // parser supplies fxRateToEurOverride.
    const unh = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.isin, "US91324P1021"))
      .get();
    expect(unh).toBeDefined();
    const unhBuy = buys.find((t) => t.assetId === unh!.id)!;
    expect(unhBuy.tradeCurrency).toBe("USD");
    expect(unhBuy.fxRateToEur).toBeCloseTo(1 / 1.09, 3);

    // Position: 2 UNH at ~551€ cost basis (600 USD × 0.9174 + fees ≈ 550.92).
    const unhPos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, unh!.id))
      .get();
    expect(unhPos?.quantity).toBeCloseTo(2, 6);
    expect(unhPos?.totalCostEur).toBeGreaterThan(550);
    expect(unhPos?.totalCostEur).toBeLessThan(552);

    // Tax lot created for UNH.
    const unhLots = db
      .select()
      .from(schema.taxLots)
      .where(eq(schema.taxLots.assetId, unh!.id))
      .all();
    expect(unhLots).toHaveLength(1);
    expect(unhLots[0].remainingQty).toBe(2);

    // Dividend gross vs net captured for Hacienda. Current storage is:
    //   dividendGross / dividendNet  → native currency (USD here)
    //   withholdingTax               → EUR (native × fx)
    // This lets the tax report present the origin-withholding in EUR for
    // the DDI credit while keeping the headline amounts in native for the
    // foreign-dividend breakdown.
    const div = dividends[0];
    expect(div.dividendGross).toBeCloseTo(6.63, 2);
    expect(div.dividendNet).toBeCloseTo(5.64, 2);
    expect(div.withholdingTax).toBeCloseTo(0.99 * 0.9174, 2);
    expect(div.sourceCountry).toBe("US");

    // FX: USD rows persisted for the mocked range.
    const fx = db
      .select()
      .from(schema.fxRates)
      .where(eq(schema.fxRates.currency, "USD"))
      .all();
    expect(fx.length).toBeGreaterThan(0);

    // Valuations: both assets have rows from first trade to a recent date.
    const vals = db.select().from(schema.assetValuations).all();
    const vwceVals = vals.filter((v) => v.assetId !== unh!.id);
    const unhVals = vals.filter((v) => v.assetId === unh!.id);
    expect(vwceVals.length).toBeGreaterThan(0);
    expect(unhVals.length).toBeGreaterThan(0);
    // UNH EUR valuation uses the Yahoo FX mid (0.9174) × unit price (310) × qty (2):
    //   310 × 0.9174 × 2 ≈ 568.79
    const lastUnhVal = unhVals.sort((a, b) =>
      a.valuationDate.localeCompare(b.valuationDate),
    )[unhVals.length - 1];
    expect(lastUnhVal.marketValueEur).toBeCloseTo(310 * 0.9174 * 2, 1);
  });

  it("is atomic: a missing FX mapping aborts the whole import", async () => {
    clearFx(); // No FX registered → resolveFxRange throws on USD.
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/FX fetch failed/);
    // Nothing landed — atomicity guarantee.
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(0);
    expect(db.select().from(schema.fxRates).all()).toHaveLength(0);
    expect(db.select().from(schema.assetValuations).all()).toHaveLength(0);
    expect(db.select().from(schema.taxLots).all()).toHaveLength(0);
  });

  it("is idempotent: re-running the same CSV skips duplicates", async () => {
    setFx("USD", mkFxBars("2026-01-01", "2026-03-31", 0.9174));
    const first = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const insertedFirst = first.data.inserted;
    expect(insertedFirst).toBeGreaterThan(0);

    const second = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!second.ok) throw new Error("second import");
    expect(second.data.inserted).toBe(0);
    expect(second.data.skippedDuplicates).toBe(insertedFirst);
  });
});
