"use server";

import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { alertEvents, auditEvents, type AlertEvent } from "../db/schema";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { acknowledgeAlertEventSchema } from "./alerts.schema";

// Dismiss a fired alert from the global banner. The banner shows every event
// with `acknowledgedAt IS NULL`; acknowledging stamps it so it never reappears.
export async function acknowledgeAlertEvent(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<AlertEvent>> {
  const parsed = acknowledgeAlertEventSchema.safeParse(input);
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
    const acked = db.transaction((tx) => {
      const previous = tx.select().from(alertEvents).where(eq(alertEvents.id, id)).get();
      if (!previous) throw new Error(`alert event not found: ${id}`);

      tx
        .update(alertEvents)
        .set({ acknowledgedAt: now })
        .where(and(eq(alertEvents.id, id), isNull(alertEvents.acknowledgedAt)))
        .run();
      const row = tx.select().from(alertEvents).where(eq(alertEvents.id, id)).get();
      if (!row) throw new Error("alert event update vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "alert_event",
          entityId: id,
          action: "acknowledge",
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

    revalidateWatchlist();
    return { ok: true, data: acked };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("alert event not found")) {
      return { ok: false, error: { code: "not_found", message: "notificación no encontrada" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
