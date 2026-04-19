import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assetTransactions } from "./asset_transactions";
import { taxLots } from "./tax_lots";
import { createdAtCol, idCol } from "./_shared";

export const taxLotConsumptions = sqliteTable(
  "tax_lot_consumptions",
  {
    id: idCol(),
    saleTransactionId: text("sale_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    lotId: text("lot_id")
      .notNull()
      .references(() => taxLots.id, { onDelete: "cascade" }),
    qtyConsumed: real("qty_consumed").notNull(),
    costBasisEur: real("cost_basis_eur").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    saleIdx: index("tax_lot_consumptions_sale_idx").on(t.saleTransactionId),
    lotIdx: index("tax_lot_consumptions_lot_idx").on(t.lotId),
    uniquePair: uniqueIndex("tax_lot_consumptions_unique_pair").on(
      t.saleTransactionId,
      t.lotId,
    ),
  }),
);

export type TaxLotConsumption = typeof taxLotConsumptions.$inferSelect;
export type NewTaxLotConsumption = typeof taxLotConsumptions.$inferInsert;
