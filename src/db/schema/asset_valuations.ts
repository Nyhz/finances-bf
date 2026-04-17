import { real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assets } from "./assets";
import { createdAtCol, idCol } from "./_shared";

export const assetValuations = sqliteTable(
  "asset_valuations",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    valuationDate: text("valuation_date").notNull(), // ISO yyyy-MM-dd
    quantity: real("quantity").notNull(),
    unitPriceEur: real("unit_price_eur").notNull(),
    marketValueEur: real("market_value_eur").notNull(),
    priceSource: text("price_source").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    assetDateIdx: uniqueIndex("asset_valuations_asset_date_idx").on(t.assetId, t.valuationDate),
  }),
);

export type AssetValuation = typeof assetValuations.$inferSelect;
export type NewAssetValuation = typeof assetValuations.$inferInsert;
