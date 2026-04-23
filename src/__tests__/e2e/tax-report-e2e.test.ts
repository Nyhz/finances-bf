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
import { buildTaxReport } from "../../server/tax/report";

// Mixed full-year story:
//   - VWCE: buy 4 @ 120 EUR → held (no realised gain).
//   - AAPL: buy 5 @ 185.20 USD (fx 0.9237) → partial sell 2 @ 192 USD (fx 0.9250)
//     → realises a small gain.
//   - UNH: dividend with origin withholding → surfaces in tax report's dividend
//     section with EUR withholding credit.
const CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
02-01-2026,09:32,02-01-2026,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,"Compra 4 Vanguard FTSE All-World@120,00 EUR (IE00BK5BQT80)",,EUR,"-480,00",EUR,"-480,00",ord-vwce
02-01-2026,09:32,02-01-2026,VANGUARD FTSE ALL-WORLD,IE00BK5BQT80,Costes de transacción,,EUR,"-1,00",EUR,"-481,00",ord-vwce
05-02-2026,15:11,05-02-2026,APPLE INC,US0378331005,"Compra 5 Apple Inc@185,20 USD (US0378331005)",,USD,"-926,00",USD,"-926,00",ord-aapl-1
05-02-2026,15:11,05-02-2026,APPLE INC,US0378331005,Costes de transacción,,USD,"-0,50",USD,"-926,50",ord-aapl-1
05-02-2026,15:12,05-02-2026,,,Retirada Cambio de Divisa,"1,0826",USD,"926,50",USD,"0,00",
05-02-2026,15:12,05-02-2026,,,Ingreso Cambio de Divisa,,EUR,"-855,82",EUR,"-1336,82",
12-03-2026,11:45,12-03-2026,APPLE INC,US0378331005,"Venta 2 Apple Inc@192,00 USD (US0378331005)",,USD,"384,00",USD,"384,00",ord-aapl-2
12-03-2026,11:45,12-03-2026,APPLE INC,US0378331005,Costes de transacción,,USD,"-0,50",USD,"383,50",ord-aapl-2
12-03-2026,11:46,12-03-2026,,,Retirada Cambio de Divisa,"1,0811",USD,"-383,50",USD,"0,00",
12-03-2026,11:46,12-03-2026,,,Ingreso Cambio de Divisa,,EUR,"354,73",EUR,"-982,09",
18-03-2026,07:02,18-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Retención del dividendo,,USD,"-0,99",USD,"-0,99",
18-03-2026,07:03,18-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"6,63",USD,"5,64",
18-03-2026,07:04,18-03-2026,,,Retirada Cambio de Divisa,"1,0905",USD,"-5,64",USD,"0,00",
18-03-2026,07:04,18-03-2026,,,Ingreso Cambio de Divisa,,EUR,"5,17",EUR,"-976,92",
`;

describe("e2e — tax report (end-of-year, realised gains + dividends)", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();
    setFx("USD", mkFxBars("2026-01-01", "2026-04-22", 0.923));
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

    await createAsset(
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
    await createAsset(
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
    await createAsset(
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
  });

  it("imports a mixed year and builds a consistent tax report", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error(res.error.message);
    void accountId;

    const report = buildTaxReport(db, 2026);

    // Exactly one AAPL sell landed in the report.
    expect(report.sales).toHaveLength(1);
    const sale = report.sales[0];

    // Proceeds sit in the ~340-360 € range regardless of the exact FX
    // rate the parser resolves (trade-time FX from the CSV vs the
    // stubbed daily rate differ by a few tenths of a percent).
    expect(sale.proceedsEur).toBeGreaterThan(340);
    expect(sale.proceedsEur).toBeLessThan(360);

    // Cost basis for 2 of 5 AAPL ≈ 40% of the ~855 € buy cost.
    expect(sale.costBasisEur).toBeGreaterThan(330);
    expect(sale.costBasisEur).toBeLessThan(355);

    // Computable gain/loss: proceeds − cost − fees. Expect small positive.
    expect(sale.computableGainLossEur).toBeGreaterThan(0);
    expect(sale.computableGainLossEur).toBeLessThan(30);

    // Dividend section picks up the UNH payment with origin-withholding
    // converted to EUR via the FX line (1.0905 USD/EUR).
    expect(report.dividends).toHaveLength(1);
    const div = report.dividends[0];
    expect(div.sourceCountry).toBe("US");
    expect(div.withholdingOrigenEur).toBeCloseTo(0.99 / 1.0905, 2);
    expect(div.grossEur).toBeCloseTo(6.63 / 1.0905, 2);

    // Position on VWCE still held, cost basis preserved on the report totals.
    const vwce = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.isin, "IE00BK5BQT80"))
      .get();
    const vwcePos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, vwce!.id))
      .get();
    expect(vwcePos?.quantity).toBeCloseTo(4, 6);

    // Totals sanity.
    expect(report.totals.netComputableEur).toBeGreaterThan(0);
  });
});
