"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetTransactions,
  assets,
  type Asset,
} from "../db/schema";
import type { ActionResult } from "./_shared";
import { parseBinanceCsv } from "../lib/imports/binance";
import { parseCobasCsv } from "../lib/imports/cobas";
import { parseDegiroCsv } from "../lib/imports/degiro";
import { parseDegiroStatementCsv } from "../lib/imports/degiro-statement";
import { assetHintKey } from "../lib/imports/_shared";
import type {
  AssetHint,
  ImportSource,
  ParsedImportRow,
} from "../lib/imports/types";
import { searchCoins as defaultSearchCoins } from "../lib/pricing";
import type { CoinCandidate } from "../lib/pricing";

import {
  previewImportSchema,
  type CryptoCandidateGroup,
  type PreviewCounts,
  type PreviewPayload,
  type PreviewRow,
  type PreviewRowStatus,
} from "./previewImport.schema";

export type PreviewImportDeps = {
  searchCoins?: (query: string) => Promise<CoinCandidate[]>;
};

function runParser(source: ImportSource, csvText: string) {
  if (source === "degiro") return parseDegiroCsv(csvText);
  if (source === "degiro-statement") return parseDegiroStatementCsv(csvText);
  if (source === "binance") return parseBinanceCsv(csvText);
  return parseCobasCsv(csvText);
}

function matchAssetForHint(
  db: DB,
  hint: AssetHint | null | undefined,
): Asset | null {
  if (!hint) return null;
  if (hint.isin) {
    const r = db.select().from(assets).where(eq(assets.isin, hint.isin)).get();
    if (r) return r;
  }
  if (hint.symbol) {
    const r = db
      .select()
      .from(assets)
      .where(eq(assets.symbol, hint.symbol))
      .get();
    if (r) return r;
  }
  if (hint.name) {
    const r = db.select().from(assets).where(eq(assets.name, hint.name)).get();
    if (r) return r;
  }
  return null;
}

function fingerprintIsDuplicate(db: DB, fingerprint: string): boolean {
  const t = db
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.rowFingerprint, fingerprint))
    .get();
  if (t) return true;
  const c = db
    .select()
    .from(accountCashMovements)
    .where(eq(accountCashMovements.rowFingerprint, fingerprint))
    .get();
  return !!c;
}

function toPreviewRow(
  db: DB,
  row: ParsedImportRow,
  index: number,
): PreviewRow {
  const duplicate = fingerprintIsDuplicate(db, row.rowFingerprint);
  const matched =
    row.kind === "trade"
      ? matchAssetForHint(db, row.assetHint)
      : matchAssetForHint(db, row.assetHint ?? null);

  let status: PreviewRowStatus = "new";
  if (duplicate) status = "duplicate";
  else if (row.kind === "trade" && !matched) status = "needs_asset_creation";

  return {
    index,
    kind: row.kind,
    status,
    tradeDate: row.tradeDate,
    rowFingerprint: row.rowFingerprint,
    currency: row.currency,
    assetHint: row.kind === "trade" ? row.assetHint : row.assetHint ?? null,
    matchedAssetId: matched?.id ?? null,
    side: row.kind === "trade" ? row.side : undefined,
    movement: row.kind === "cash_movement" ? row.movement : undefined,
    quantity: row.kind === "trade" ? row.quantity : undefined,
    priceNative: row.kind === "trade" ? row.priceNative : undefined,
    amountNative: row.kind === "cash_movement" ? row.amountNative : undefined,
    fees: row.kind === "trade" ? row.fees ?? null : null,
  };
}

async function collectCryptoCandidates(
  rows: PreviewRow[],
  searchCoins: (query: string) => Promise<CoinCandidate[]>,
): Promise<CryptoCandidateGroup[]> {
  const bySymbol = new Map<string, { symbol: string; symbolKey: string }>();
  for (const row of rows) {
    if (row.status !== "needs_asset_creation") continue;
    if (row.kind !== "trade") continue;
    const hint = row.assetHint;
    const symbol = hint?.symbol?.trim();
    if (!symbol) continue;
    const key = assetHintKey(hint ?? null);
    if (!key) continue;
    if (!bySymbol.has(key)) {
      bySymbol.set(key, { symbol: symbol.toUpperCase(), symbolKey: key });
    }
  }
  const groups: CryptoCandidateGroup[] = [];
  for (const { symbol, symbolKey } of bySymbol.values()) {
    try {
      const raw = await searchCoins(symbol);
      const exact = raw.filter((c) => c.symbol.toUpperCase() === symbol);
      const pool = (exact.length > 0 ? exact : raw).slice(0, 10);
      const sorted = [...pool].sort((a, b) => {
        const ra = a.marketCapRank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.marketCapRank ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
      groups.push({ symbolKey, symbol, candidates: sorted, error: null });
    } catch (err) {
      groups.push({
        symbolKey,
        symbol,
        candidates: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return groups;
}

export async function previewImport(
  input: unknown,
  db: DB = defaultDb,
  deps: PreviewImportDeps = {},
): Promise<ActionResult<PreviewPayload>> {
  const parsed = previewImportSchema.safeParse(input);
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
  const { source, accountId, csvText } = parsed.data;

  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) {
    return {
      ok: false,
      error: { code: "not_found", message: `account not found: ${accountId}` },
    };
  }

  const parseResult = runParser(source, csvText);
  // Track asset hints we've already flagged as "needs creation" inside this
  // batch so subsequent rows of the same asset don't re-request creation.
  const pendingHintKeys = new Set<string>();
  const rows = parseResult.rows.map((r, i) => {
    const row = toPreviewRow(db, r, i);
    if (row.status === "needs_asset_creation") {
      const key = assetHintKey(row.assetHint ?? null);
      if (key && pendingHintKeys.has(key)) {
        return { ...row, status: "new" as PreviewRowStatus };
      }
      if (key) pendingHintKeys.add(key);
    }
    return row;
  });
  const counts: PreviewCounts = {
    total: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    needsAssetCreation: rows.filter(
      (r) => r.status === "needs_asset_creation",
    ).length,
    errors: parseResult.errors.length,
  };
  const cryptoCandidates =
    source === "binance"
      ? await collectCryptoCandidates(
          rows,
          deps.searchCoins ?? defaultSearchCoins,
        )
      : [];

  return {
    ok: true,
    data: {
      source,
      accountId,
      rows,
      errors: parseResult.errors,
      counts,
      cryptoCandidates,
    },
  };
}
