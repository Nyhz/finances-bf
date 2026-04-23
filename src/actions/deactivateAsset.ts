"use server";


import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, type Asset } from "../db/schema";
import { ACTOR, type ActionResult, revalidateAssetMetadata } from "./_shared";

import { deactivateAssetSchema } from "./deactivateAsset.schema";

export async function deactivateAsset(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = deactivateAssetSchema.safeParse(input);
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
    const updated = db.transaction((tx) => {
      const previous = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!previous) throw new Error(`asset not found: ${id}`);

      tx.update(assets).set({ isActive: false, updatedAt: now }).where(eq(assets.id, id)).run();

      const row = tx.select().from(assets).where(eq(assets.id, id)).get();
      if (!row) throw new Error("asset update vanished");

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "asset",
          entityId: id,
          action: "deactivate",
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

    revalidateAssetMetadata();
    return { ok: true, data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    const code = message.startsWith("asset not found") ? "not_found" : "db";
    return { ok: false, error: { code, message } };
  }
}
