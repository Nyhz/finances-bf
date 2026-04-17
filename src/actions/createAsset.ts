"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { assets, auditEvents, type Asset } from "../db/schema";
import { ACTOR, ASSET_TYPES, type ActionResult } from "./_shared";

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code");

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(32),
  isin: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i, "ISIN must be 12 alphanumeric characters")
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  assetType: z.enum(ASSET_TYPES),
  currency: currencyCode,
  exchange: z.string().trim().max(32).nullable().optional(),
  providerSymbol: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;

function revalidateAssetPaths() {
  revalidatePath("/assets");
  revalidatePath("/overview");
  revalidatePath("/audit");
}

export async function createAsset(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Asset>> {
  const parsed = createAssetSchema.safeParse(input);
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

  const data = parsed.data;
  const now = Date.now();
  const id = ulid();

  try {
    const inserted = db.transaction((tx) => {
      tx
        .insert(assets)
        .values({
          id,
          name: data.name,
          assetType: data.assetType,
          symbol: data.symbol,
          isin: data.isin ?? null,
          exchange: data.exchange ?? null,
          providerSymbol: data.providerSymbol ?? null,
          currency: data.currency,
          isActive: data.isActive,
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

    revalidateAssetPaths();
    return { ok: true, data: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
