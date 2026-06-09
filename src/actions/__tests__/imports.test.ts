import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// No network in tests: confirmImport prefetches FX for every non-EUR row
// (incl. dividends since audit fix T3), so resolveFxRange must be stubbed.
vi.mock("../../lib/fx-backfill", async () => {
  const actual = await vi.importActual<typeof import("../../lib/fx-backfill")>(
    "../../lib/fx-backfill",
  );
  return { ...actual, resolveFxRange: resolveFxRangeStub };
});
import { clearFx, mkFxBars, resolveFxRangeStub, setFx } from "../../__tests__/e2e/_helpers";

beforeEach(() => {
  clearFx();
  // The DEGIRO statement fixtures carry USD rows; register a synthetic USD
  // curve so the (stubbed) FX prefetch succeeds.
  setFx("USD", mkFxBars("2026-03-01", "2026-12-31", 0.87));
});

import { createAccount } from "../accounts";
import { previewImport } from "../previewImport";
import { confirmImport } from "../confirmImport";

// Minimal DEGIRO statement CSV: one dividend pair for UnitedHealth (USD) plus
// the FX-conversion rows that allow the parser to derive fxRateToEurOverride.
// FX column = native-per-EUR (1.1481 USD/EUR) → rateToEur = 1/1.1481 ≈ 0.8709
const STATEMENT_DIV_CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
19-03-2026,06:40,18-03-2026,,,Ingreso Cambio de Divisa,,EUR,"4,91",EUR,"115,16",
19-03-2026,06:40,18-03-2026,,,Retirada Cambio de Divisa,"1,1481",USD,"-5,64",USD,"0,00",
18-03-2026,07:03,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"6,63",USD,"5,64",
18-03-2026,07:02,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Retención del dividendo,,USD,"-0,99",USD,"-0,99",
`;


function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

async function setupAccount(db: DB, opening = 0) {
  const acc = await createAccount(
    {
      name: "DeGiro",
      accountType: "savings",
      currency: "EUR",
      openingBalanceNative: opening,
    },
    db,
  );
  if (!acc.ok) throw new Error("account setup");
  return acc.data.id;
}

const BINANCE_CSV = `"Date(UTC)","Pair","Side","Price","Executed","Amount","Fee"
"2026-03-01 10:00:00","BNBEUR","BUY","650","0.1BNB","65EUR","0.00001BNB"
"2026-03-02 10:00:00","ETHEUR","BUY","3000","0.01ETH","30EUR","0.00002BNB"
`;

describe("previewImport — Binance crypto candidate lookup", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    accountId = await setupAccount(db);
  });

  it("returns CoinGecko candidate groups for each unresolved crypto symbol", async () => {
    const searchCoins = vi.fn(async (query: string) => {
      if (query === "BNB") {
        return [
          {
            id: "binancecoin",
            symbol: "BNB",
            name: "BNB",
            marketCapRank: 4,
            thumb: null,
          },
        ];
      }
      if (query === "ETH") {
        return [
          {
            id: "ethereum",
            symbol: "ETH",
            name: "Ethereum",
            marketCapRank: 2,
            thumb: null,
          },
          {
            id: "ethereum-classic",
            symbol: "ETC",
            name: "Ethereum Classic",
            marketCapRank: 30,
            thumb: null,
          },
        ];
      }
      return [];
    });

    const res = await previewImport(
      { source: "binance", accountId, csvText: BINANCE_CSV },
      db,
      { searchCoins },
    );
    if (!res.ok) throw new Error("preview failed");
    const groups = res.data.cryptoCandidates;
    const byKey = new Map(groups.map((g) => [g.symbol, g]));
    expect(byKey.get("BNB")?.candidates[0].id).toBe("binancecoin");
    // Exact-symbol match filter drops ETC from the ETH group.
    expect(byKey.get("ETH")?.candidates.map((c) => c.id)).toEqual(["ethereum"]);
    expect(searchCoins).toHaveBeenCalledWith("BNB");
    expect(searchCoins).toHaveBeenCalledWith("ETH");
  });

  it("surfaces a per-group error when the CoinGecko lookup throws", async () => {
    const searchCoins = vi.fn(async () => {
      throw new Error("coingecko 429 rate limited");
    });
    const res = await previewImport(
      { source: "binance", accountId, csvText: BINANCE_CSV },
      db,
      { searchCoins },
    );
    if (!res.ok) throw new Error("preview failed");
    for (const g of res.data.cryptoCandidates) {
      expect(g.candidates).toEqual([]);
      expect(g.error).toMatch(/429/);
    }
  });
});

describe("confirmImport — degiro-statement dividend persistence", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    // Use a broker account so tracksCash is false — dividends go to
    // asset_transactions, not accountCashMovements.
    const acc = await createAccount(
      { name: "DeGiro Broker", accountType: "broker", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    accountId = acc.data.id;
  });

  it("inserts a dividend asset_transaction with correct mapping", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_DIV_CSV },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${res.error.message}`);

    expect(res.data.insertedDividends).toBe(1);
    expect(res.data.insertedTrades).toBe(0);
    expect(res.data.insertedCashMovements).toBe(0);
    expect(res.data.createdAssets).toBe(1); // UnitedHealth auto-created

    const rows = db.select().from(schema.assetTransactions).all();
    expect(rows).toHaveLength(1);
    const div = rows[0];

    expect(div.transactionType).toBe("dividend");
    expect(div.sourceCountry).toBe("US"); // inferred from ISIN US91324P1021
    // fxRate derived from EUR leg (4.91) / USD leg (5.64) by deriveFxRate
    const expectedFx = 4.91 / 5.64;
    expect(div.fxRateToEur).toBeCloseTo(expectedFx, 4);
    expect(div.tradeGrossAmount).toBeCloseTo(6.63, 4);
    expect(div.tradeGrossAmountEur).toBeCloseTo(6.63 * expectedFx, 2);
    // withholdingTax (origen EUR) = roundEur(0.99 * fxRate)
    expect(div.withholdingTax).toBeGreaterThan(0);
    expect(div.withholdingTax).toBeCloseTo(0.99 * expectedFx, 2);
    expect(div.dividendGross).toBeCloseTo(6.63, 4);
    // dividendNet = grossNative - withholdingOrigenNative = 6.63 - 0.99 = 5.64 (native)
    expect(div.dividendNet).toBeCloseTo(5.64, 2);
    expect(div.quantity).toBe(0);
    expect(div.unitPrice).toBe(0);
    expect(div.tradeCurrency).toBe("USD");
    // rowFingerprint must be set (non-null)
    expect(div.rowFingerprint).toBeTruthy();
  });

  it("deduplicates: second import of same dividend is skipped", async () => {
    const first = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_DIV_CSV },
      db,
    );
    expect(first.ok).toBe(true);
    const second = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_DIV_CSV },
      db,
    );
    if (!second.ok) throw new Error("second confirm failed");
    expect(second.data.insertedDividends).toBe(0);
    expect(second.data.skippedDuplicates).toBe(1);
    // Still only one row in DB
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(1);
  });
});

describe("confirmImport — cryptoProviderOverrides", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    accountId = await setupAccount(db, 1000);
  });

  it("writes providerSymbol on auto-created assets when an override is supplied", async () => {
    // Resolve the symbolKey the parser will produce for a BNB hint.
    const { parseBinanceCsv } = await import("../../lib/imports/binance");
    const { assetHintKey } = await import("../../lib/imports/_shared");
    const parsed = parseBinanceCsv(BINANCE_CSV);
    const bnbTrade = parsed.rows.find(
      (r) => r.kind === "trade" && r.assetHint.symbol === "BNB",
    );
    if (!bnbTrade || bnbTrade.kind !== "trade") throw new Error("no bnb trade");
    const bnbKey = assetHintKey(bnbTrade.assetHint);
    expect(bnbKey).toBeTruthy();

    const res = await confirmImport(
      {
        source: "binance",
        accountId,
        csvText: BINANCE_CSV,
        cryptoProviderOverrides: { [bnbKey!]: "binancecoin" },
      },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${res.error.message}`);

    const bnb = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.symbol, "BNB"))
      .get();
    expect(bnb?.providerSymbol).toBe("binancecoin");
    expect(bnb?.assetType).toBe("crypto");
  });
});

// Audit T3: the FX prefetch plan must cover dividend/cash rows, not only
// trades. This CSV has NO FX-conversion rows (so no fxRateToEurOverride) and
// no trades — the dividend's EUR value must come from the prefetched
// fx_rates, or the whole import must abort.
const STATEMENT_DIV_NO_FX_CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
18-03-2026,07:03,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"6,63",USD,"5,64",
18-03-2026,07:02,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Retención del dividendo,,USD,"-0,99",USD,"-0,99",
`;

describe("confirmImport — FX plan covers dividend-only batches (T3)", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      { name: "DeGiro Broker", accountType: "broker", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    accountId = acc.data.id;
  });

  it("fetches USD rates for a dividend-only import and stamps fxSource", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_DIV_NO_FX_CSV },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${res.error.message}`);
    expect(res.data.insertedDividends).toBe(1);

    const div = db.select().from(schema.assetTransactions).all()[0];
    expect(div.fxRateToEur).toBeCloseTo(0.87, 6); // from the stubbed USD curve
    expect(div.fxSource).toBe("historical");
    expect(div.tradeGrossAmountEur).toBeCloseTo(6.63 * 0.87, 2);
  });

  it("aborts the whole import when FX for a dividend currency cannot be fetched", async () => {
    clearFx(); // stub now throws for USD
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_DIV_NO_FX_CSV },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/FX fetch failed/);
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(0);
    expect(db.select().from(schema.fxRates).all()).toHaveLength(0);
  });
});

// Audit T6/R-11: crypto-crypto permuta legs persist valuationBasis=market-fx;
// fiat-quoted trades stay null (user data).
const BINANCE_PERMUTA_CSV = `"Date(UTC)","Pair","Side","Price","Executed","Amount","Fee"
"2026-02-28 09:00:00","BTCEUR","BUY","55000","0.02BTC","1100EUR","0.00001BNB"
"2026-03-01 10:00:00","ETHBTC","BUY","0.05","0.2ETH","0.01BTC","0.0001BNB"
"2026-03-02 10:00:00","BNBEUR","BUY","650","0.1BNB","65EUR","0.00001BNB"
`;

describe("confirmImport — permuta valuation basis (T6)", () => {
  it("marks both legs of a crypto-quoted trade and leaves fiat trades unmarked", async () => {
    const db = makeDb();
    setFx("BTC", mkFxBars("2026-02-25", "2026-12-31", 60_000, { weekdaysOnly: false }), "coingecko-fx");
    const accountId = await setupAccount(db, 1000);
    const res = await confirmImport(
      { source: "binance", accountId, csvText: BINANCE_PERMUTA_CSV },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${res.error.message}`);

    const rows = db.select().from(schema.assetTransactions).all();
    const marked = rows.filter((r) => r.valuationBasis === "market-fx");
    const unmarked = rows.filter((r) => r.valuationBasis == null);
    // ETHBTC emits two market-valued legs (ETH buy + BTC sell);
    // BTCEUR and BNBEUR are fiat-quoted legs, unmarked.
    expect(marked).toHaveLength(2);
    expect(unmarked).toHaveLength(2);
    for (const r of unmarked) expect(r.tradeCurrency).toBe("EUR");
    for (const r of marked) expect(r.fxSource).toBe("historical");
  });
});

// Audit R8: parse failures block the commit until explicitly acknowledged,
// and the row-level errors are persisted in the import audit event.
const STATEMENT_WITH_BAD_ROW_CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
18-03-2026,07:03,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"6,63",USD,"5,64",
not-a-date,07:02,17-03-2026,UNITEDHEALTH GROUP INC,US91324P1021,Dividendo,,USD,"1,00",USD,"1,00",
`;

describe("confirmImport — parse-error acknowledgement (R8)", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    const acc = await createAccount(
      { name: "DeGiro Broker", accountType: "broker", currency: "EUR", openingBalanceNative: 0 },
      db,
    );
    if (!acc.ok) throw new Error("account setup");
    accountId = acc.data.id;
  });

  it("refuses to commit unacknowledged parse errors, writing nothing", async () => {
    const res = await confirmImport(
      { source: "degiro", accountId, csvText: STATEMENT_WITH_BAD_ROW_CSV },
      db,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation");
      expect(res.error.message).toMatch(/failed to parse/);
    }
    expect(db.select().from(schema.assetTransactions).all()).toHaveLength(0);
  });

  it("commits with acknowledgeErrors and persists the errors in the audit event", async () => {
    const res = await confirmImport(
      {
        source: "degiro", accountId,
        csvText: STATEMENT_WITH_BAD_ROW_CSV,
        acknowledgeErrors: true,
      },
      db,
    );
    if (!res.ok) throw new Error(`confirm failed: ${res.error.message}`);
    expect(res.data.insertedDividends).toBe(1);
    expect(res.data.skippedErrors).toBe(1);

    const audit = db
      .select()
      .from(schema.auditEvents)
      .all()
      .find((e) => e.entityType === "import");
    expect(audit).toBeDefined();
    const payload = JSON.parse(audit!.nextJson!) as {
      parseErrors: Array<{ rowIndex: number; message: string }>;
    };
    expect(payload.parseErrors).toHaveLength(1);
    expect(payload.parseErrors[0].message).toMatch(/Date/i);
  });
});
