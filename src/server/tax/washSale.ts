import { and, eq, gt, gte, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { roundEur } from "../../lib/money";
import { DAY_MS } from "../../lib/time";
import type { db, DB } from "../../db/client";
import {
  assetTransactions,
  assets,
  taxLots,
  taxWashSaleAdjustments,
  type AssetTransaction,
} from "../../db/schema";

// Accepts a top-level DB handle or a Drizzle transaction handle.
type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];
type DbOrTx = DB | Tx;


export function checkSaleAtLoss(
  tx: DbOrTx,
  saleRow: AssetTransaction,
  proceedsEur: number,
  consumedCostEur: number,
  feesEur: number,
): void {
  const loss = proceedsEur - consumedCostEur - feesEur;
  if (loss >= 0) return;

  const asset = tx.select().from(assets).where(eq(assets.id, saleRow.assetId)).get();
  const windowDays = asset?.assetClassTax === "unlisted_security" ? 365 : 60;
  const windowMs = windowDays * DAY_MS;

  const acquisitions = tx
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.assetId, saleRow.assetId),
        eq(assetTransactions.transactionType, "buy"),
        gte(assetTransactions.tradedAt, saleRow.tradedAt - windowMs),
        lte(assetTransactions.tradedAt, saleRow.tradedAt + windowMs),
      ),
    )
    .all();

  if (acquisitions.length === 0) return;

  // Only consider acquisitions that still have an open lot after the sell
  // (the original lots consumed by the FIFO sell are fully drained and won't
  // have a surviving lot to absorb the deferral).
  const acqsWithLots = acquisitions.flatMap((acq) => {
    const lot = tx
      .select()
      .from(taxLots)
      .where(and(eq(taxLots.originTransactionId, acq.id), gt(taxLots.remainingQty, 0)))
      .get();
    if (!lot) return [];
    return [{ acq, lot }];
  });

  if (acqsWithLots.length === 0) return;

  const soldQty = saleRow.quantity;
  const acquiredQty = acqsWithLots.reduce((sum, { acq }) => sum + acq.quantity, 0);
  const absorbingQty = Math.min(soldQty, acquiredQty);
  if (absorbingQty <= 0) return;

  const totalDisallowed = Math.abs(loss) * (absorbingQty / soldQty);

  for (const { acq, lot } of acqsWithLots) {
    const share = roundEur((acq.quantity / acquiredQty) * totalDisallowed);
    if (share <= 0.005) continue;

    tx.insert(taxWashSaleAdjustments).values({
      id: ulid(),
      saleTransactionId: saleRow.id,
      absorbingLotId: lot.id,
      disallowedLossEur: share,
      windowDays,
    }).run();

    tx.update(taxLots)
      .set({ deferredLossAddedEur: roundEur((lot.deferredLossAddedEur ?? 0) + share) })
      .where(eq(taxLots.id, lot.id))
      .run();
  }
}
