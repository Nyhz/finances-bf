import { asc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client";
import { alertEvents, assets, type AlertEvent } from "../db/schema";

export type ActiveAlertEvent = AlertEvent & {
  assetName: string;
  assetSymbol: string | null;
};

// Fired alerts the Commander hasn't dismissed yet — drives the global banner.
// Ordered oldest-first so the longest-standing alert sits on top.
export async function listUnacknowledgedAlertEvents(
  db: DB = defaultDb,
): Promise<ActiveAlertEvent[]> {
  const rows = await db
    .select({
      event: alertEvents,
      assetName: assets.name,
      assetSymbol: assets.symbol,
    })
    .from(alertEvents)
    .innerJoin(assets, eq(alertEvents.assetId, assets.id))
    .where(isNull(alertEvents.acknowledgedAt))
    .orderBy(asc(alertEvents.triggeredAt))
    .all();
  return rows.map((r) => ({ ...r.event, assetName: r.assetName, assetSymbol: r.assetSymbol }));
}
