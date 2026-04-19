"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  assets,
  auditEvents,
  fxRates,
  type Asset,
} from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";
import {
  recomputeAccountCashBalance,
  recomputeAssetPosition,
} from "../server/recompute";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { parseBinanceCsv } from "../lib/imports/binance";
import { parseCobasCsv } from "../lib/imports/cobas";
import { parseDegiroCsv } from "../lib/imports/degiro";
import { parseDegiroStatementCsv } from "../lib/imports/degiro-statement";
import { assetHintKey } from "../lib/imports/_shared";
import { roundEur } from "../lib/money";
import type {
  AssetHint,
  ImportSource,
  ParsedImportRow,
} from "../lib/imports/types";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

import { confirmImportSchema, type ConfirmImportResult } from "./confirmImport.schema";

function runParser(source: ImportSource, csvText: string) {
  if (source === "degiro") return parseDegiroCsv(csvText);
  if (source === "degiro-statement") return parseDegiroStatementCsv(csvText);
  if (source === "binance") return parseBinanceCsv(csvText);
  return parseCobasCsv(csvText);
}


function findAsset(tx: Tx, hint: AssetHint | null | undefined): Asset | null {
  if (!hint) return null;
  if (hint.isin) {
    const r = tx.select().from(assets).where(eq(assets.isin, hint.isin)).get();
    if (r) return r;
  }
  if (hint.symbol) {
    const r = tx.select().from(assets).where(eq(assets.symbol, hint.symbol)).get();
    if (r) return r;
  }
  if (hint.name) {
    const r = tx.select().from(assets).where(eq(assets.name, hint.name)).get();
    if (r) return r;
  }
  return null;
}

function resolveFx(tx: Tx, currency: string, isoDate: string): number {
  if (currency === "EUR") return 1;
  const onDate = tx
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), eq(fxRates.date, isoDate)))
    .get();
  if (onDate) return onDate.rateToEur;
  const latest = tx
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), lte(fxRates.date, isoDate)))
    .orderBy(desc(fxRates.date))
    .get();
  if (!latest) {
    throw new Error(`No FX rate available for ${currency} on ${isoDate}`);
  }
  return latest.rateToEur;
}

function isDuplicate(tx: Tx, fingerprint: string): boolean {
  const t = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.rowFingerprint, fingerprint))
    .get();
  if (t) return true;
  const c = tx
    .select()
    .from(accountCashMovements)
    .where(eq(accountCashMovements.rowFingerprint, fingerprint))
    .get();
  return !!c;
}

function autoCreateAsset(
  tx: Tx,
  hint: AssetHint,
  currency: string,
  source: ImportSource,
  providerSymbol: string | null = null,
): Asset {
  const now = Date.now();
  const id = ulid();
  const name = hint.name || hint.symbol || hint.isin || "Unknown";
  tx
    .insert(assets)
    .values({
      id,
      name,
      assetType: source === "binance" ? "crypto" : "other",
      symbol: hint.symbol ?? null,
      isin: hint.isin ?? null,
      currency,
      providerSymbol,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const row = tx.select().from(assets).where(eq(assets.id, id)).get();
  if (!row) throw new Error("asset insert vanished");
  tx
    .insert(auditEvents)
    .values({
      id: ulid(),
      entityType: "asset",
      entityId: id,
      action: "create",
      actorType: "system",
      source: "import",
      summary: `Auto-created from ${source} import`,
      previousJson: null,
      nextJson: JSON.stringify(row),
      contextJson: JSON.stringify({ actor: ACTOR, source }),
      createdAt: now,
    })
    .run();
  return row;
}

function insertTrade(
  tx: Tx,
  accountId: string,
  assetId: string,
  row: Extract<ParsedImportRow, { kind: "trade" }>,
  source: ImportSource,
  tracksCash: boolean,
): void {
  const rate =
    row.fxRateToEurOverride != null && row.fxRateToEurOverride > 0
      ? row.fxRateToEurOverride
      : resolveFx(tx, row.currency, row.tradeDate);
  const sign = row.side === "buy" ? -1 : 1;
  const tradeGrossAmount = row.quantity * row.priceNative;
  const tradeGrossAmountEur = roundEur(tradeGrossAmount * rate);
  const fees = row.fees ?? 0;
  const feesAmountEur = row.feesAlreadyEur ? roundEur(fees) : roundEur(fees * rate);
  const cashImpactEur = sign * roundEur(tradeGrossAmountEur) - feesAmountEur;
  const tradedAt = new Date(`${row.tradeDate}T12:00:00.000Z`).getTime();
  const id = ulid();
  const now = Date.now();
  tx
    .insert(assetTransactions)
    .values({
      id,
      accountId,
      assetId,
      transactionType: row.side,
      tradedAt,
      quantity: row.quantity,
      unitPrice: row.priceNative,
      tradeCurrency: row.currency,
      fxRateToEur: rate,
      tradeGrossAmount: roundEur(tradeGrossAmount),
      tradeGrossAmountEur,
      cashImpactEur: roundEur(cashImpactEur),
      feesAmount: fees,
      feesAmountEur,
      netAmountEur: roundEur(cashImpactEur),
      rowFingerprint: row.rowFingerprint,
      source,
      createdAt: now,
      updatedAt: now,
      rawPayload: JSON.stringify(row.rawRow),
    })
    .run();
  if (tracksCash) {
    tx
      .insert(accountCashMovements)
      .values({
        id: ulid(),
        accountId,
        movementType: "trade",
        occurredAt: tradedAt,
        nativeAmount: roundEur(sign * tradeGrossAmount - fees),
        currency: row.currency,
        fxRateToEur: rate,
        cashImpactEur: roundEur(cashImpactEur),
        externalReference: id,
        rowFingerprint: `trade:${id}`,
        source,
        affectsCashBalance: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

function insertCashMovement(
  tx: Tx,
  accountId: string,
  row: Extract<ParsedImportRow, { kind: "cash_movement" }>,
  source: ImportSource,
): void {
  const rate = resolveFx(tx, row.currency, row.tradeDate);
  const cashImpactEur = roundEur(row.amountNative * rate);
  const occurredAt = new Date(`${row.tradeDate}T12:00:00.000Z`).getTime();
  const now = Date.now();
  tx
    .insert(accountCashMovements)
    .values({
      id: ulid(),
      accountId,
      movementType: row.movement,
      occurredAt,
      nativeAmount: row.amountNative,
      currency: row.currency,
      fxRateToEur: rate,
      cashImpactEur,
      rowFingerprint: row.rowFingerprint,
      source,
      affectsCashBalance: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function insertDividend(
  tx: Tx,
  accountId: string,
  assetId: string,
  row: Extract<ParsedImportRow, { kind: "dividend" }>,
  source: ImportSource,
): void {
  const fxRate =
    row.fxRateToEurOverride != null && row.fxRateToEurOverride > 0
      ? row.fxRateToEurOverride
      : resolveFx(tx, row.currency, row.tradeDate);
  const grossEur = roundEur(row.grossNative * fxRate);
  const whtOrigenEur = roundEur(row.withholdingOrigenNative * fxRate);
  const whtDestinoEur = row.withholdingDestinoEur ?? 0;
  const netEur = roundEur(grossEur - whtOrigenEur - whtDestinoEur);
  const tradedAt = new Date(`${row.tradeDate}T12:00:00.000Z`).getTime();
  const now = Date.now();
  const id = ulid();
  tx
    .insert(assetTransactions)
    .values({
      id,
      accountId,
      assetId,
      transactionType: "dividend",
      tradedAt,
      quantity: 0,
      unitPrice: 0,
      tradeCurrency: row.currency,
      fxRateToEur: fxRate,
      tradeGrossAmount: row.grossNative,
      tradeGrossAmountEur: grossEur,
      cashImpactEur: netEur,
      feesAmount: 0,
      feesAmountEur: 0,
      netAmountEur: netEur,
      dividendGross: row.grossNative,
      dividendNet: roundEur(row.grossNative - row.withholdingOrigenNative),
      withholdingTax: whtOrigenEur,
      withholdingTaxDestination: whtDestinoEur > 0 ? whtDestinoEur : null,
      sourceCountry: row.sourceCountry ?? null,
      isListed: true,
      rowFingerprint: row.rowFingerprint,
      source,
      rawPayload: JSON.stringify(row.rawRow),
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export async function confirmImport(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<ConfirmImportResult>> {
  const parsed = confirmImportSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }
  const { source, accountId, csvText, overrides, cryptoProviderOverrides } =
    parsed.data;

  const parseResult = runParser(source, csvText);

  try {
    const result = db.transaction((tx): ConfirmImportResult => {
      const account = tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get();
      if (!account) throw new Error(`account not found: ${accountId}`);

      const tracksCash =
        account.accountType === "bank" || account.accountType === "savings";

      const touchedAssets = new Set<string>();
      const fingerprints: string[] = [];
      let insertedTrades = 0;
      let insertedCashMovements = 0;
      let insertedDividends = 0;
      let skippedDuplicates = 0;
      let createdAssets = 0;

      parseResult.rows.forEach((row, index) => {
        if (isDuplicate(tx, row.rowFingerprint)) {
          skippedDuplicates++;
          return;
        }

        if (row.kind === "trade") {
          const override = overrides?.[String(index)]?.assetId;
          let asset: Asset | null = null;
          if (override) {
            asset = tx.select().from(assets).where(eq(assets.id, override)).get() ?? null;
            if (!asset) throw new Error(`override assetId not found: ${override}`);
          } else {
            asset = findAsset(tx, row.assetHint);
          }
          if (!asset) {
            const key = assetHintKey(row.assetHint);
            const providerSymbol =
              (key && cryptoProviderOverrides?.[key]?.trim()) || null;
            asset = autoCreateAsset(
              tx,
              row.assetHint,
              row.currency,
              source,
              providerSymbol,
            );
            createdAssets++;
          }
          insertTrade(tx, accountId, asset.id, row, source, tracksCash);
          touchedAssets.add(asset.id);
          insertedTrades++;
          fingerprints.push(row.rowFingerprint);
        } else if (row.kind === "cash_movement") {
          if (tracksCash) {
            insertCashMovement(tx, accountId, row, source);
            insertedCashMovements++;
          }
          fingerprints.push(row.rowFingerprint);
        } else {
          // row.kind === "dividend" — persist as asset_transaction with type "dividend"
          let asset: Asset | null = findAsset(tx, row.assetHint);
          if (!asset) {
            asset = autoCreateAsset(tx, row.assetHint, row.currency, source);
            createdAssets++;
          }
          insertDividend(tx, accountId, asset.id, row, source);
          touchedAssets.add(asset.id);
          insertedDividends++;
          fingerprints.push(row.rowFingerprint);
        }
      });

      for (const assetId of touchedAssets) {
        recomputeAssetPosition(tx, accountId, assetId);
        recomputeLotsForAsset(tx, assetId);
      }
      if (tracksCash) {
        recomputeAccountCashBalance(tx, accountId);
      }

      const inserted = insertedTrades + insertedCashMovements + insertedDividends;
      const summary = `${source} import: ${inserted} inserted, ${skippedDuplicates} duplicates, ${createdAssets} new assets`;
      const importId = ulid();
      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "import",
          entityId: importId,
          action: "commit",
          actorType: "user",
          source: "ui",
          summary,
          previousJson: null,
          nextJson: JSON.stringify({
            source,
            accountId,
            inserted,
            insertedTrades,
            insertedCashMovements,
            insertedDividends,
            skippedDuplicates,
            skippedErrors: parseResult.errors.length,
            createdAssets,
            fingerprints,
          }),
          contextJson: JSON.stringify({ actor: ACTOR, source }),
          createdAt: Date.now(),
        })
        .run();

      return {
        inserted,
        insertedTrades,
        insertedCashMovements,
        insertedDividends,
        skippedDuplicates,
        skippedErrors: parseResult.errors.length,
        createdAssets,
        fingerprints,
      };
    });

    revalidatePath("/imports");
    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/overview");
    revalidatePath("/");
    revalidatePath("/assets");
    revalidatePath("/audit");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("account not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
