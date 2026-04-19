import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { assets } from "./assets";
import { assetTransactions } from "./asset_transactions";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const taxLots = sqliteTable(
  "tax_lots",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    originTransactionId: text("origin_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    acquiredAt: integer("acquired_at", { mode: "number" }).notNull(),
    originalQty: real("original_qty").notNull(),
    remainingQty: real("remaining_qty").notNull(),
    unitCostEur: real("unit_cost_eur").notNull(),
    deferredLossAddedEur: real("deferred_loss_added_eur").notNull().default(0),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    assetAcquiredIdx: index("tax_lots_asset_acquired_idx").on(t.assetId, t.acquiredAt),
    originIdx: uniqueIndex("tax_lots_origin_idx").on(t.originTransactionId),
  }),
);

export type TaxLot = typeof taxLots.$inferSelect;
export type NewTaxLot = typeof taxLots.$inferInsert;
