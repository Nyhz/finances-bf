import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { assetTransactions } from "./asset_transactions";
import { taxLots } from "./tax_lots";
import { createdAtCol, idCol } from "./_shared";

export const taxWashSaleAdjustments = sqliteTable(
  "tax_wash_sale_adjustments",
  {
    id: idCol(),
    saleTransactionId: text("sale_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    absorbingLotId: text("absorbing_lot_id")
      .notNull()
      .references(() => taxLots.id, { onDelete: "cascade" }),
    disallowedLossEur: real("disallowed_loss_eur").notNull(),
    windowDays: integer("window_days", { mode: "number" }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    saleIdx: index("tax_wash_sale_adjustments_sale_idx").on(t.saleTransactionId),
    lotIdx: index("tax_wash_sale_adjustments_lot_idx").on(t.absorbingLotId),
  }),
);

export type TaxWashSaleAdjustment = typeof taxWashSaleAdjustments.$inferSelect;
export type NewTaxWashSaleAdjustment = typeof taxWashSaleAdjustments.$inferInsert;
