import { lt } from "drizzle-orm";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";

export type Model720Block = {
  country: string;
  type: "broker-securities" | "bank-accounts" | "crypto";
  valueEur: number;
};

export type AnnotatedBlock = Model720Block & {
  status: "ok" | "new" | "delta_20k" | "full_exit";
  lastDeclaredEur: number | null;
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

function findLastDeclared(
  snapshots: SnapshotPayload[],
  match: (b: AnnotatedBlock) => boolean,
): number | null {
  for (const snap of snapshots) {
    const found = blocksFromPayload(snap).find(match);
    if (found) return found.valueEur;
  }
  return null;
}

function annotate(
  snapshots: SnapshotPayload[],
  blocks: Model720Block[],
): AnnotatedBlock[] {
  const out: AnnotatedBlock[] = [];

  for (const b of blocks) {
    const lastDeclared = findLastDeclared(
      snapshots,
      (x) => x.country === b.country && x.type === b.type,
    );
    let status: AnnotatedBlock["status"];
    if (lastDeclared == null) {
      status = b.valueEur >= 50_000 ? "new" : "ok";
    } else if (Math.abs(b.valueEur - lastDeclared) > 20_000) {
      status = "delta_20k";
    } else {
      status = "ok";
    }
    out.push({ ...b, status, lastDeclaredEur: lastDeclared });
  }

  const seenKeys = new Set(out.map((b) => `${b.country}::${b.type}`));
  const exitSeen = new Set<string>();
  for (const snap of snapshots) {
    for (const prior of blocksFromPayload(snap)) {
      const key = `${prior.country}::${prior.type}`;
      if (seenKeys.has(key) || exitSeen.has(key)) continue;
      exitSeen.add(key);
      out.push({
        country: prior.country,
        type: prior.type,
        valueEur: 0,
        status: "full_exit",
        lastDeclaredEur: prior.valueEur,
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
