import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { assets } from "./assets";
import { createdAtCol, idCol, updatedAtCol } from "./_shared";

// Price alerts attached to a watchlisted asset. Evaluated on every intraday
// `sync-watchlist` run against the latest `watchlist_quotes.price` (native quote
// currency). `kind` decides the comparison; `threshold` is in the same currency
// as the asset's quote.
export const ALERT_KINDS = ["price_below", "price_above"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

// `armed`  → not currently triggered; will fire when the condition is met.
// `triggered` → already fired; re-arms automatically (hysteresis) once the price
//   crosses back to the safe side, so a hovering price doesn't re-fire each run.
export const ALERT_STATUSES = ["armed", "triggered"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const priceAlerts = sqliteTable(
  "price_alerts",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<AlertKind>(),
    threshold: real("threshold").notNull(),
    /** Also push a Telegram message when this alert fires (the in-app banner is
     *  always shown). Uses the shared `sendTelegram` helper. */
    notifyTelegram: integer("notify_telegram", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status").notNull().$type<AlertStatus>().default("armed"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastTriggeredAt: integer("last_triggered_at", { mode: "number" }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => ({
    assetIdx: index("price_alerts_asset_idx").on(t.assetId),
  }),
);

export type PriceAlert = typeof priceAlerts.$inferSelect;
export type NewPriceAlert = typeof priceAlerts.$inferInsert;
