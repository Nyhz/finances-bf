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
    // Acquisition cost stored SEPARATELY (gross vs fees) and as lot totals,
    // never as a pre-rounded per-unit figure: rounding the unit cost to cents
    // and multiplying back by quantity inflated the basis (e.g. +0.58 € on a
    // 158-unit lot). Consumption math derives exact values from these totals.
    grossCostEur: real("gross_cost_eur").notNull().default(0),
    feesEur: real("fees_eur").notNull().default(0),
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
