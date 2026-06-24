"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, priceAlerts, type PriceAlert } from "../db/schema";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { deleteAlertSchema } from "./alerts.schema";

export async function deleteAlert(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<PriceAlert>> {
  const parsed = deleteAlertSchema.safeParse(input);
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

  const { id } = parsed.data;
  const now = Date.now();

  try {
    const removed = db.transaction((tx) => {
      const previous = tx.select().from(priceAlerts).where(eq(priceAlerts.id, id)).get();
      if (!previous) throw new Error(`alert not found: ${id}`);

      // alert_events cascade-delete with the alert (FK ON DELETE cascade).
      tx.delete(priceAlerts).where(eq(priceAlerts.id, id)).run();

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "price_alert",
          entityId: id,
          action: "delete",
          actorType: "user",
          source: "ui",
          summary: null,
          previousJson: JSON.stringify(previous),
          nextJson: null,
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();

      return previous;
    });

    revalidateWatchlist();
    return { ok: true, data: removed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("alert not found")) {
      return { ok: false, error: { code: "not_found", message: "alerta no encontrada" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
