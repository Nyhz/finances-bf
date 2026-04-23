"use server";


import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import {
  assetPositions,
  assetTransactions,
  assetValuations,
  assets,
  auditEvents,
} from "../db/schema";
import { ACTOR, type ActionResult, revalidateAssetMetadata } from "./_shared";
import { deleteAssetSchema } from "./deleteAsset.schema";

// Hard-delete an asset along with its valuations and positions. Refuses if
// any asset_transactions still reference it — delete those (or wipe the
// account) first. Valuations cascade via the schema; positions are cleared
// explicitly for clarity.
export async function deleteAsset(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteAssetSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Invalid input",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { id } = parsed.data;
  const now = Date.now();

  try {
    db.transaction((tx) => {
      const previous = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!previous) throw new Error(`asset not found: ${id}`);

      const txCount = tx
        .select({ n: sql<number>`count(*)` })
        .from(assetTransactions)
        .where(eq(assetTransactions.assetId, id))
        .get();
      if ((txCount?.n ?? 0) > 0) {
        throw new Error("asset has transactions");
      }

      tx.delete(assetPositions).where(eq(assetPositions.assetId, id)).run();
      tx.delete(assetValuations).where(eq(assetValuations.assetId, id)).run();
      tx.delete(assets).where(eq(assets.id, id)).run();

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
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
    });

    revalidateAssetMetadata();
    return { ok: true, data: { id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    if (message === "asset has transactions") {
      return { ok: false, error: { code: "conflict", message } };
    }
    if (message.startsWith("asset not found")) {
      return { ok: false, error: { code: "not_found", message } };
    }
    return { ok: false, error: { code: "db", message } };
  }
}
