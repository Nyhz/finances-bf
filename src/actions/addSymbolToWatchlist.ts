"use server";

import { revalidatePath } from "next/cache";
import { eq, or } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, type Asset } from "../db/schema";
import { ACTOR, type ActionResult, revalidateWatchlist } from "./_shared";
import { refreshWatchlistQuote } from "./refreshWatchlistQuote";

const schema = z.object({
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
});

// "Añadir a watchlist" from a Discover card. A discovered candidate is a
// market-wide ticker we may not own, so we find-or-create the `assets` row
// (by provider symbol / symbol / ticker), flag it watchlisted, then pull an
// intraday quote so its watchlist card isn't blank.
export async function addSymbolToWatchlist(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "Datos no válidos" } };
  }
  const { symbol, name } = parsed.data;
  const now = Date.now();

  try {
    const asset = db.transaction((tx) => {
      const existing = tx
        .select()
        .from(assets)
        .where(
          or(
            eq(assets.providerSymbol, symbol),
            eq(assets.symbol, symbol),
            eq(assets.ticker, symbol),
          ),
        )
        .get();

      if (existing) {
        if (!existing.isWatchlisted) {
          tx.update(assets).set({ isWatchlisted: true, updatedAt: now }).where(eq(assets.id, existing.id)).run();
        }
        const row = tx.select().from(assets).where(eq(assets.id, existing.id)).get();
        tx
          .insert(auditEvents)
          .values({
            id: ulid(),
            entityType: "asset",
            entityId: existing.id,
            action: "watchlist_add",
            actorType: "user",
            source: "discover",
            summary: null,
            previousJson: JSON.stringify(existing),
            nextJson: JSON.stringify(row),
            contextJson: JSON.stringify({ actor: ACTOR }),
            createdAt: now,
          })
          .run();
        return row!;
      }

      // Create a minimal stock asset for the discovered ticker.
      const id = ulid();
      tx
        .insert(assets)
        .values({
          id,
          name,
          assetType: "stock",
          symbol,
          providerSymbol: symbol,
          currency: "EUR",
          isActive: true,
          isWatchlisted: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const row = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!row) throw new Error("asset insert vanished");
      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "discover",
          summary: null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({ actor: ACTOR }),
          createdAt: now,
        })
        .run();
      return row;
    });

    // Best-effort immediate quote so the watchlist card shows a price at once.
    await refreshWatchlistQuote({ assetId: asset.id }, db);

    revalidateWatchlist();
    revalidatePath("/discover"); // reflect the "ya en watchlist" state on the card
    return { ok: true, data: asset };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
