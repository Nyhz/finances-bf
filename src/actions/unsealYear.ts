"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, taxYearSnapshots } from "../db/schema";
import { ACTOR, type ActionResult } from "./_shared";
import { unsealYearSchema } from "./sealYear.schema";

export async function unsealYear(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ year: number }>> {
  const parsed = unsealYearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
  const { year } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const existing = tx.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
      if (!existing) throw new Error(`year ${year} is not sealed`);
      tx.delete(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).run();
      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "tax_year",
        entityId: String(year),
        action: "unseal",
        actorType: "user",
        source: "ui",
        summary: `unsealed year ${year}`,
        previousJson: JSON.stringify({ snapshotId: existing.id }),
        nextJson: null,
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();
      return { year };
    });
    revalidatePath("/taxes");
    revalidatePath(`/taxes/${year}`);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
