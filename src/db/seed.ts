import { sql } from "drizzle-orm";
import { ulid } from "ulid";
import { db, sqlite } from "./client";
import {
  accounts,
  assetPositions,
  assetTransactions,
  assetValuations,
  assets,
  auditEvents,
} from "./schema";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function main() {
  const existing = db.select({ n: sql<number>`count(*)` }).from(accounts).get();
  if ((existing?.n ?? 0) > 0) {
    console.log("seed: already populated, skipping");
    sqlite.close();
    return;
  }

  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  const accountId = ulid();
  const assetId = ulid();
  const transactionId = ulid();
  const positionId = ulid();
  const valuationId = ulid();
  const auditId = ulid();

  const quantity = 10;
  const unitPrice = 85.0;
  const fee = 1.0;
  const gross = quantity * unitPrice;
  const net = gross + fee;
  const valuationPrice = 88.0;
  const openingCash = 500000;
  const currentCash = openingCash - net;

  db.transaction((tx) => {
    tx.insert(accounts)
      .values({
        id: accountId,
        name: "Revolut EUR",
        currency: "EUR",
        accountType: "bank",
        openingBalanceEur: openingCash,
        currentCashBalanceEur: currentCash,
      })
      .run();

    tx.insert(assets)
      .values({
        id: assetId,
        name: "Vanguard S&P 500 UCITS ETF",
        assetType: "etf",
        symbol: "VUAA.DE",
        ticker: "VUAA",
        currency: "EUR",
        isActive: true,
      })
      .run();

    tx.insert(assetTransactions)
      .values({
        id: transactionId,
        accountId,
        assetId,
        transactionType: "buy",
        tradedAt: yesterday,
        quantity,
        unitPrice,
        tradeCurrency: "EUR",
        fxRateToEur: 1,
        tradeGrossAmount: gross,
        tradeGrossAmountEur: gross,
        cashImpactEur: -net,
        feesAmount: fee,
        feesAmountEur: fee,
        netAmountEur: net,
        rowFingerprint: "seed:buy:vuaa:1",
        source: "seed",
      })
      .run();

    tx.insert(assetPositions)
      .values({
        id: positionId,
        assetId,
        quantity,
        averageCost: unitPrice,
      })
      .run();

    tx.insert(assetValuations)
      .values({
        id: valuationId,
        assetId,
        valuationDate: isoDate(new Date()),
        quantity,
        unitPriceEur: valuationPrice,
        marketValueEur: quantity * valuationPrice,
        priceSource: "seed",
      })
      .run();

    tx.insert(auditEvents)
      .values({
        id: auditId,
        entityType: "seed",
        entityId: auditId,
        action: "seed",
        actorType: "system",
        source: "seed-script",
        summary: "Initial development seed data",
        previousJson: null,
        nextJson: JSON.stringify({
          accounts: 1,
          assets: 1,
          transactions: 1,
          positions: 1,
          valuations: 1,
        }),
      })
      .run();
  });

  console.log("seed: done");
  sqlite.close();
}

main();
