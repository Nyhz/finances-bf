"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, priceAlerts, watchlistQuotes, type Asset } from "../db/schema";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { toggleAssetWatchlistSchema } from "./toggleAssetWatchlist.schema";

export async function toggleAssetWatchlist(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = toggleAssetWatchlistSchema.safeParse(input);
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

  const { id, watchlisted } = parsed.data;
  const now = Date.now();

  try {
    const updated = db.transaction((tx) => {
      const previous = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!previous) throw new Error(`asset not found: ${id}`);

      tx.update(assets).set({ isWatchlisted: watchlisted, updatedAt: now }).where(eq(assets.id, id)).run();
      const row = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!row) throw new Error("asset update vanished");

      // Removing an asset from the watchlist discards its alerts (and their fired
      // events, via FK cascade) — they should not linger and reappear if the
      // asset is starred again later.
      if (!watchlisted) {
        tx.delete(priceAlerts).where(eq(priceAlerts.assetId, id)).run();
        tx.delete(watchlistQuotes).where(eq(watchlistQuotes.assetId, id)).run();
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: id,
          action: watchlisted ? "watchlist_add" : "watchlist_remove",
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
    return { ok: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message: "activo no encontrado" } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
