import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assets } from "./assets";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

export const assetPositions = sqliteTable(
  "asset_positions",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    quantity: real("quantity").notNull().default(0),
    averageCost: real("average_cost_eur").notNull().default(0),
    manualPrice: real("manual_price"),
    manualPriceAsOf: integer("manual_price_as_of", { mode: "number" }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    assetIdx: uniqueIndex("asset_positions_asset_idx").on(t.assetId),
  }),
);

export type AssetPosition = typeof assetPositions.$inferSelect;
export type NewAssetPosition = typeof assetPositions.$inferInsert;
