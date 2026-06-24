import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { assets } from "./assets";
import { priceAlerts, type AlertKind } from "./price_alerts";
import { createdAtCol, idCol } from "./_shared";

// A fired alert that needs acknowledgement. The app-wide banner renders every
// row with `acknowledgedAt IS NULL` and keeps it visible (with a glow) until the
// Commander dismisses it manually — this is the "permanent notification until I
// confirm I've seen it" requirement. `priceAtTrigger`/`currency` snapshot the
// quote at fire time so the banner reads correctly even after later refreshes.
export const alertEvents = sqliteTable(
  "alert_events",
  {
    id: idCol(),
    alertId: text("alert_id")
      .notNull()
      .references(() => priceAlerts.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<AlertKind>(),
    threshold: real("threshold").notNull(),
    priceAtTrigger: real("price_at_trigger").notNull(),
    currency: text("currency").notNull(),
    triggeredAt: integer("triggered_at", { mode: "number" }).notNull(),
    acknowledgedAt: integer("acknowledged_at", { mode: "number" }),
    telegramSent: integer("telegram_sent", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAtCol(),
  },
  (t) => ({
    ackIdx: index("alert_events_ack_idx").on(t.acknowledgedAt),
  }),
);

export type AlertEvent = typeof alertEvents.$inferSelect;
export type NewAlertEvent = typeof alertEvents.$inferInsert;
