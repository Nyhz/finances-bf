"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { alertEvents, assets, auditEvents, priceAlerts, type PriceAlert } from "../db/schema";
import { sendTelegram } from "../lib/advisor/telegram";
import { fireAlertIfMet } from "../lib/watchlist-sync";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { createAlertSchema } from "./alerts.schema";

export async function createAlert(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PriceAlert>> {
  const parsed = createAlertSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { assetId, kind, threshold, notifyTelegram } = parsed.data;
  const now = Date.now();

  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
  }

  let created: PriceAlert;
  try {
    created = db.transaction((tx) => {
      const id = ulid();
      tx
        .insert(priceAlerts)
        .values({
          id,
          assetId,
          kind,
          threshold,
          notifyTelegram,
          status: "armed",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const row = tx.select().from(priceAlerts).where(eq(priceAlerts.id, id)).get();
      if (!row) throw new Error("alert insert vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "price_alert",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return row;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }

  // Evaluate against the cached intraday price right away so an alert that's
  // already met fires immediately instead of waiting for the next cron tick.
  const fire = fireAlertIfMet(
    db,
    {
      alertId: created.id,
      assetId,
      kind: created.kind,
      threshold: created.threshold,
      status: created.status,
      assetName: asset.name,
      assetSymbol: asset.symbol,
    },
    now,
  );
  if (fire && notifyTelegram) {
    const res = await sendTelegram(fire.message);
    if (res.ok) {
      db.update(alertEvents).set({ telegramSent: true }).where(eq(alertEvents.id, fire.eventId)).run();
    }
  }

  revalidateWatchlist();
  return { ok: true, data: created };
}
