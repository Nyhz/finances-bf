"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { alertEvents, assets, auditEvents, priceAlerts, type PriceAlert } from "../db/schema";
import { sendTelegram } from "../lib/advisor/telegram";
import { fireAlertIfMet } from "../lib/watchlist-sync";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { updateAlertSchema } from "./alerts.schema";

export async function updateAlert(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PriceAlert>> {
  const parsed = updateAlertSchema.safeParse(input);
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

  const { id, kind, threshold, notifyTelegram } = parsed.data;
  const now = Date.now();

  try {
    const updated = db.transaction((tx) => {
      const previous = tx.select().from(priceAlerts).where(eq(priceAlerts.id, id)).get();
      if (!previous) throw new Error(`alert not found: ${id}`);

      // Editing the condition re-arms the alert so it re-evaluates cleanly
      // against the next quote instead of staying stuck in a stale triggered state.
      tx
        .update(priceAlerts)
        .set({ kind, threshold, notifyTelegram, status: "armed", updatedAt: now })
        .where(eq(priceAlerts.id, id))
        .run();
      const row = tx.select().from(priceAlerts).where(eq(priceAlerts.id, id)).get();
      if (!row) throw new Error("alert update vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "price_alert",
          entityId: id,
          action: "update",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(previous),
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return row;
    });

    // Re-evaluate immediately against the cached intraday price (the edit just
    // re-armed it), so a still-met condition fires without waiting for the cron.
    const asset = db.select().from(assets).where(eq(assets.id, updated.assetId)).get();
    if (asset) {
      const fire = fireAlertIfMet(
        db,
        {
          alertId: updated.id,
          assetId: updated.assetId,
          kind: updated.kind,
          threshold: updated.threshold,
          status: updated.status,
          assetName: asset.name,
          assetSymbol: asset.symbol,
        },
      );
      if (fire && notifyTelegram) {
        const res = await sendTelegram(fire.message);
        if (res.ok) {
          db.update(alertEvents).set({ telegramSent: true }).where(eq(alertEvents.id, fire.eventId)).run();
        }
      }
    }

    revalidateWatchlist();
    return { ok: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("alert not found")) {
      return { ok: false, error: { code: "not_found", message: "alerta no encontrada" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
