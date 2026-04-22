"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  accounts,
  assetPositions,
  assetTransactions,
  auditEvents,
  dailyBalances,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
  taxYearSnapshots,
  transactionImportRows,
  transactionImports,
} from "../db/schema";
import type { ActionResult } from "./_shared";

const wipeAppSchema = z.object({
  confirmation: z.literal("WIPE"),
});

// Wipes the operational state of the app (accounts, transactions, imports,
// audit, derived balances) while preserving the immutable reference data:
// assets, asset_valuations, price_history, fx_rates. Equivalent to starting
// a clean book of records without re-downloading price history.
export async function wipeApp(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ wiped: true }>> {
  const parsed = wipeAppSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Type WIPE to confirm",
      },
    };
  }

  try {
    db.transaction((tx) => {
      // Children first for clarity (cascades would otherwise handle most).
      tx.delete(taxWashSaleAdjustments).run();
      tx.delete(taxLotConsumptions).run();
      tx.delete(taxLots).run();
      tx.delete(taxYearSnapshots).run();
      tx.delete(transactionImportRows).run();
      tx.delete(transactionImports).run();
      tx.delete(accountCashMovements).run();
      tx.delete(assetTransactions).run();
      tx.delete(assetPositions).run();
      tx.delete(dailyBalances).run();
      tx.delete(accounts).run();
      tx.delete(auditEvents).run();
    });

    for (const p of [
      "/",
      "/overview",
      "/accounts",
      "/transactions",
      "/assets",
      "/audit",
      "/taxes",
      "/imports",
      "/settings",
    ]) {
      revalidatePath(p);
    }

    return { ok: true, data: { wiped: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
