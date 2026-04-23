import type { db as dbModule } from "../db/client";
import {
  recomputeAccountCashBalance,
  recomputeAssetPosition,
} from "./recompute";
import { recomputeLotsForAsset } from "./tax/lots";
import { rebuildValuationsForAsset } from "./valuations";

type Tx = Parameters<Parameters<(typeof dbModule)["transaction"]>[0]>[0];

/**
 * One-shot recompute that runs after any action which mutates
 * `asset_transactions` (insert, delete, bulk reimport).
 *
 * Wraps the triad every caller otherwise duplicates:
 *
 *   recomputeAssetPosition    → `asset_positions`
 *   recomputeLotsForAsset     → `tax_lots` + `tax_lot_consumptions`
 *   rebuildValuationsForAsset → `asset_valuations`
 *
 * Plus the account's cash-balance refresh (no-op for non-savings accounts).
 *
 * The single place to plug in new derived state. If we ever add a per-account
 * P/L cache, a FIFO realisation summary, or similar, extend this function —
 * every call site automatically benefits without touching each action.
 */
export function rebuildAfterTradeMutation(
  tx: Tx,
  accountId: string,
  assetIds: string | Iterable<string>,
): void {
  const ids =
    typeof assetIds === "string" ? [assetIds] : [...new Set(assetIds)];
  for (const id of ids) {
    recomputeAssetPosition(tx, accountId, id);
    recomputeLotsForAsset(tx, id);
    rebuildValuationsForAsset(tx, id);
  }
  recomputeAccountCashBalance(tx, accountId);
}
