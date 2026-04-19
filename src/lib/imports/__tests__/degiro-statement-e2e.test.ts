import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { parseDegiroStatementCsv } from "../degiro-statement";
import { recomputeLotsForAsset } from "../../../server/tax/lots";
import { buildTaxReport } from "../../../server/tax/report";
import { inferAssetClassTax } from "../../../server/tax/classification";

const FIXTURE = readFileSync(
  join(__dirname, "../__fixtures__/degiro-statement.sample.csv"),
  "utf8",
);

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

function isoToMs(iso: string): number {
  return new Date(`${iso}T12:00:00.000Z`).getTime();
}

describe("DEGIRO statement → tax report end-to-end", () => {
  it("imports the fixture and produces a correct multi-year report", () => {
    const db = makeDb();
    const accountId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker", countryCode: "NL",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();

    const parsed = parseDegiroStatementCsv(FIXTURE);
    expect(parsed.errors).toHaveLength(0);

    // Materialise assets from unique ISINs.
    const assetIdByIsin = new Map<string, string>();
    for (const row of parsed.rows) {
      if (!row.assetHint) continue;
      const isin = row.assetHint.isin ?? null;
      if (!isin || assetIdByIsin.has(isin)) continue;
      const id = ulid();
      const name = row.assetHint.name ?? isin;
      const cls = inferAssetClassTax({ assetType: "equity", name, isin });
      db.insert(assets).values({
        id, name, assetType: "equity", isin, currency: "EUR",
        isActive: true, assetClassTax: cls,
      }).run();
      assetIdByIsin.set(isin, id);
    }

    for (const row of parsed.rows) {
      if (!row.assetHint) continue;
      const isin = row.assetHint.isin;
      if (!isin) continue;
      const assetId = assetIdByIsin.get(isin)!;
      const tradedAt = isoToMs(row.tradeDate);

      if (row.kind === "trade") {
        const fxRate = row.fxRateToEurOverride ?? 1;
        const grossNative = row.quantity * row.priceNative;
        const grossEur = grossNative * fxRate;
        const feesNative = row.fees ?? 0;
        const feesEur = row.feesAlreadyEur ? feesNative : feesNative * fxRate;
        const cashImpact = row.side === "buy" ? -(grossEur + feesEur) : grossEur - feesEur;
        db.insert(assetTransactions).values({
          id: ulid(), accountId, assetId,
          transactionType: row.side, tradedAt,
          quantity: row.quantity, unitPrice: row.priceNative,
          tradeCurrency: row.currency, fxRateToEur: fxRate,
          tradeGrossAmount: grossNative, tradeGrossAmountEur: grossEur,
          cashImpactEur: cashImpact,
          feesAmount: feesNative, feesAmountEur: feesEur,
          netAmountEur: cashImpact,
          isListed: true,
          source: "degiro-statement",
          rowFingerprint: row.rowFingerprint,
        }).run();
      } else if (row.kind === "dividend") {
        const fxRate = row.fxRateToEurOverride ?? 1;
        const grossEur = row.grossNative * fxRate;
        const whtOrigenEur = row.withholdingOrigenNative * fxRate;
        const whtDestinoEur = row.withholdingDestinoEur ?? 0;
        const netEur = grossEur - whtOrigenEur - whtDestinoEur;
        db.insert(assetTransactions).values({
          id: ulid(), accountId, assetId,
          transactionType: "dividend", tradedAt,
          quantity: 0, unitPrice: 0,
          tradeCurrency: row.currency, fxRateToEur: fxRate,
          tradeGrossAmount: row.grossNative, tradeGrossAmountEur: grossEur,
          cashImpactEur: netEur,
          feesAmount: 0, feesAmountEur: 0,
          netAmountEur: netEur,
          dividendGross: row.grossNative,
          dividendNet: row.grossNative - row.withholdingOrigenNative,
          withholdingTax: whtOrigenEur,
          withholdingTaxDestination: whtDestinoEur,
          sourceCountry: row.sourceCountry ?? null,
          isListed: true,
          source: "degiro-statement",
          rowFingerprint: row.rowFingerprint,
        }).run();
      }
    }

    db.transaction((tx) => {
      for (const id of assetIdByIsin.values()) {
        recomputeLotsForAsset(tx as unknown as DB, id);
      }
    });

    const report2025 = buildTaxReport(db, 2025);
    const report2026 = buildTaxReport(db, 2026);

    // Fixture has no sells.
    expect(report2025.sales).toHaveLength(0);
    expect(report2025.totals.netComputableEur).toBe(0);

    // 2 UNH dividends in 2025.
    const div2025 = report2025.dividends;
    expect(div2025.length).toBeGreaterThanOrEqual(2);
    for (const d of div2025) {
      expect(d.sourceCountry).toBe("US");
      expect(d.withholdingOrigenEur).toBeGreaterThan(0.8);
      expect(d.withholdingOrigenEur).toBeLessThan(1.0);
    }

    // 1 UNH dividend in 2026.
    expect(report2026.dividends.length).toBeGreaterThanOrEqual(1);
  });
});
