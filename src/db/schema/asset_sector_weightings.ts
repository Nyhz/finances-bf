import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";
import { assets } from "./assets";

/** Sector composition snapshot per asset (ETFs/funds). One row per
 *  (asset, sector); `weight` is a fraction 0..1 of the fund's holdings.
 *  Refreshed by the price-sync cron from Yahoo `topHoldings.sectorWeightings`.
 *  Slow-moving data — kept as a point-in-time snapshot, no history. */
export const assetSectorWeightings = sqliteTable(
  "asset_sector_weightings",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sector: text("sector").notNull(),
    weight: real("weight").notNull(),
    source: text("source").notNull(),
    fetchedAt: integer("fetched_at", { mode: "number" }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    assetSectorIdx: uniqueIndex("asset_sector_weightings_asset_sector_idx").on(
      t.assetId,
      t.sector,
    ),
  }),
);

export type AssetSectorWeighting = typeof assetSectorWeightings.$inferSelect;
export type NewAssetSectorWeighting = typeof assetSectorWeightings.$inferInsert;
