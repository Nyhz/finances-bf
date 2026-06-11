import { lt } from "drizzle-orm";
import { marketEur, type MarketEur } from "../../lib/money-types";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";

export type Model720Block = {
  country: string;
  type: "broker-securities" | "bank-accounts" | "crypto";
  /** Sum of the VALUED balances only — see hasUnvalued. */
  valueEur: MarketEur;
  /** At least one position in this block has no year-end valuation; the
   *  50k/20k threshold checks below are unreliable until it is valued. */
  hasUnvalued: boolean;
  /** At least one position was valued with a stale (>10d old) valuation. */
  hasStale: boolean;
  /** The account behind these balances has no countryCode — the block is the
   *  "??" sentinel and cannot be matched to any treaty/threshold geography.
   *  Optional so sealed payloads from before this field existed still parse. */
  hasUnknownCountry?: boolean;
};

export type AnnotatedBlock = Model720Block & {
  status: "ok" | "new" | "delta_20k" | "full_exit";
  lastDeclaredEur: number | null;
  /** True when this block's status implies an actual filing for its year
   *  (first declaration, re-declaration, or extinction). Persisted at seal
   *  time; optional so older sealed payloads — which only carry the status
   *  string — still parse and are interpreted via wasDeclared(). */
  declared?: boolean;
};

export type InformationalModelsStatus = {
  m720: { blocks: AnnotatedBlock[] };
  m721: { blocks: AnnotatedBlock[] };
  d6: { blocks: AnnotatedBlock[] };
};

type SnapshotPayload = {
  m720?: { blocks?: AnnotatedBlock[] };
  m721?: { blocks?: AnnotatedBlock[] };
  d6?: { blocks?: AnnotatedBlock[] };
};

function loadPriorSnapshots(db: DB, year: number): SnapshotPayload[] {
  const rows = db.select().from(taxYearSnapshots).where(lt(taxYearSnapshots.year, year)).all();
  rows.sort((a, b) => b.year - a.year);
  const out: SnapshotPayload[] = [];
  for (const snap of rows) {
    try {
      out.push(JSON.parse(snap.payloadJson) as SnapshotPayload);
    } catch {
      continue;
    }
  }
  return out;
}

function blocksFromPayload(payload: SnapshotPayload): AnnotatedBlock[] {
  return [
    ...(payload.m720?.blocks ?? []),
    ...(payload.m721?.blocks ?? []),
    ...(payload.d6?.blocks ?? []),
  ].filter((b): b is AnnotatedBlock => !!b && !!b.country && !!b.type);
}

/** Did this prior sealed block correspond to an ACTUAL filing? A year sealed
 *  at €45k with status "ok" was never presented — it must not poison
 *  lastDeclaredEur. New payloads persist an explicit `declared` flag; older
 *  payloads only carry the status string, where "new" and "delta_20k" are the
 *  statuses that implied a filing. */
function wasDeclared(b: AnnotatedBlock): boolean {
  return b.declared ?? (b.status === "new" || b.status === "delta_20k");
}

function findLastDeclared(
  snapshots: SnapshotPayload[],
  match: (b: AnnotatedBlock) => boolean,
): number | null {
  for (const snap of snapshots) {
    const found = blocksFromPayload(snap).find((b) => wasDeclared(b) && match(b));
    if (found) return found.valueEur;
  }
  return null;
}

function annotate(
  snapshots: SnapshotPayload[],
  blocks: Model720Block[],
): AnnotatedBlock[] {
  const out: AnnotatedBlock[] = [];

  // Art. 42 bis/ter RD 1065/2007 (and the M721 crypto rule) set the €50.000
  // first-declaration threshold on the JOINT value of each asset CATEGORY —
  // all foreign securities together, all foreign accounts together, all
  // crypto together — regardless of country. Blocks stay per-country for
  // presentation, but the obligation is decided at category level.
  const categoryTotals = new Map<Model720Block["type"], number>();
  for (const b of blocks) {
    categoryTotals.set(b.type, (categoryTotals.get(b.type) ?? 0) + b.valueEur);
  }

  for (const b of blocks) {
    const lastDeclared = findLastDeclared(
      snapshots,
      (x) => x.country === b.country && x.type === b.type,
    );
    let status: AnnotatedBlock["status"];
    if (lastDeclared == null) {
      status = (categoryTotals.get(b.type) ?? 0) >= 50_000 ? "new" : "ok";
    } else if (Math.abs(b.valueEur - lastDeclared) > 20_000) {
      status = "delta_20k";
    } else {
      status = "ok";
    }
    out.push({
      ...b,
      status,
      lastDeclaredEur: lastDeclared,
      declared: status === "new" || status === "delta_20k",
    });
  }

  const seenKeys = new Set(out.map((b) => `${b.country}::${b.type}`));
  const exitSeen = new Set<string>();
  for (const snap of snapshots) {
    for (const prior of blocksFromPayload(snap)) {
      const key = `${prior.country}::${prior.type}`;
      if (seenKeys.has(key) || exitSeen.has(key)) continue;
      exitSeen.add(key);
      // Only an actually-filed block can be extinguished; a sub-threshold
      // "ok" year never reached Hacienda, so its disappearance is a no-op.
      // valueEur > 0 keeps a declared extinction from re-emitting forever.
      if (!wasDeclared(prior) || prior.valueEur <= 0) continue;
      out.push({
        country: prior.country,
        type: prior.type,
        valueEur: marketEur(0),
        hasUnvalued: false,
        hasStale: false,
        status: "full_exit",
        lastDeclaredEur: prior.valueEur,
        declared: true,
      });
    }
  }

  return out;
}

export function computeInformationalModelsStatus(
  db: DB,
  year: number,
  blocks: Model720Block[],
): InformationalModelsStatus {
  const foreign = blocks.filter((b) => b.country !== "ES");
  const snapshots = loadPriorSnapshots(db, year);
  const annotated = annotate(snapshots, foreign);
  const m720 = annotated.filter(
    (b) => b.type === "broker-securities" || b.type === "bank-accounts",
  );
  const m721 = annotated.filter((b) => b.type === "crypto");
  const d6 = annotated.filter(
    (b) => b.type === "broker-securities" && b.status !== "ok",
  );
  return { m720: { blocks: m720 }, m721: { blocks: m721 }, d6: { blocks: d6 } };
}
