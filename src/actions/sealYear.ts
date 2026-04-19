"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { auditEvents, taxYearSnapshots } from "../db/schema";
import { buildTaxReport } from "../server/tax/report";
import { computeInformationalModelsStatus } from "../server/tax/m720";
import { aggregateBlocksFromBalances } from "../server/tax/m720Aggregate";
import { ACTOR, type ActionResult } from "./_shared";
import { sealYearSchema } from "./sealYear.schema";

export async function sealYear(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ year: number; snapshotId: string }>> {
  const parsed = sealYearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
  const { year, notes } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const existing = tx.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
      if (existing) throw new Error(`year ${year} is already sealed`);
      const report = buildTaxReport(tx as unknown as DB, year);
      const blocks = aggregateBlocksFromBalances(report.yearEndBalances);
      const models = computeInformationalModelsStatus(tx as unknown as DB, year, blocks);
      const payload = { report, ...models };
      const id = ulid();
      tx.insert(taxYearSnapshots).values({
        id, year,
        sealedAt: Date.now(),
        payloadJson: JSON.stringify(payload),
        notes: notes ?? null,
      }).run();
      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "tax_year",
        entityId: String(year),
        action: "seal",
        actorType: "user",
        source: "ui",
        summary: `sealed year ${year}`,
        previousJson: null,
        nextJson: JSON.stringify({ snapshotId: id }),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();
      return { year, snapshotId: id };
    });
    revalidatePath("/taxes");
    revalidatePath(`/taxes/${year}`);
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
