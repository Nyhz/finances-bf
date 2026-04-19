# Tax UI Rework + Seals + Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the UI rework, year-sealing, drift detection, and AEAT-ready exports described in §4, §7, parts of §3 of the [spec](../specs/2026-04-19-spanish-tax-reporting-design.md). Plus `createSwap` and dividend form, plus an FX-rate column on `/transactions` so cross-currency trades are transparent.

**Architecture:** `/taxes/[year]` becomes a dynamic route. A new `src/server/tax/m720.ts` computes 720/721/D-6 status. `src/actions/sealYear.ts` snapshots the report as a `tax_year_snapshots` row. All monetary renders go through `<SensitiveValue>` (CLAUDE.md). Exports live under `src/app/api/exports/tax/`. Swap + dividend are new Server Actions backed by `asset_transactions` rows with `linkedTransactionId` for swap pairing.

**Tech Stack:** Next 16 App Router, Drizzle, Vitest, jsPDF (already used), Tailwind. No new deps.

---

## File Structure

### New files

**Engine / server:**
- `src/server/tax/m720.ts` — `computeInformationalModelsStatus(year)` + refile-trigger logic
- `src/server/tax/seals.ts` — `sealYear`, `unsealYear`, `getSnapshot`, `computeDriftSinceSeal` (read helpers)
- `src/server/tax/__tests__/m720.test.ts`
- `src/server/tax/__tests__/seals.test.ts`

**Actions (mutations):**
- `src/actions/sealYear.ts` + `.schema.ts`
- `src/actions/unsealYear.ts`
- `src/actions/createSwap.ts` + `.schema.ts`
- `src/actions/createDividend.ts` + `.schema.ts`
- `src/actions/__tests__/sealYear.test.ts`
- `src/actions/__tests__/createSwap.test.ts`
- `src/actions/__tests__/createDividend.test.ts`

**UI — `/taxes/[year]`:**
- `src/app/taxes/[year]/page.tsx` (replaces `src/app/taxes/page.tsx`)
- `src/app/taxes/page.tsx` becomes a redirect to the current year
- `src/components/features/taxes/TaxesHeader.tsx` — year picker + seal button + export dropdown
- `src/components/features/taxes/TaxKpiRow.tsx` — 7 KPI cards
- `src/components/features/taxes/GainsTable.tsx` — realised sales with lot-expansion
- `src/components/features/taxes/DividendsTable.tsx` — dividends with retenciones
- `src/components/features/taxes/YearEndCard.tsx` — 720/721/D-6 refile status block
- `src/components/features/taxes/DriftBanner.tsx`
- `src/components/features/taxes/SealYearButton.tsx` (client)
- `src/components/features/taxes/UnsealYearButton.tsx` (client)
- `src/components/features/taxes/ExportMenu.tsx` (client)

**UI — new transaction forms:**
- `src/components/features/transactions/CreateSwapModal.tsx`
- `src/components/features/transactions/CreateDividendModal.tsx`

**Exports (API routes):**
- `src/app/api/exports/tax/casillas/route.ts`
- `src/app/api/exports/tax/detail/route.ts`
- `src/app/api/exports/tax/m720-diff/route.ts`
- `src/app/api/exports/tax/pdf/route.ts` (replaces `/api/exports/tax-report`)

**Export builders:**
- `src/lib/exports/tax-casillas.ts` + test
- `src/lib/exports/tax-detail.ts` + test
- `src/lib/exports/tax-m720-diff.ts` + test
- `src/lib/pdf/tax-report.ts` (major rewrite)

### Modified files

- `src/server/tax/report.ts` — add `yearEndBalances` field to `TaxReport`
- `src/app/transactions/page.tsx` — add FX rate column (reveal when currency ≠ EUR)
- `src/app/taxes/page.tsx` — becomes redirect shim
- `src/db/schema/audit_events.ts` — no change; used as-is
- `CLAUDE.md` — no change

### Deleted files

- `src/app/api/exports/tax-report/route.ts` — replaced by `src/app/api/exports/tax/pdf/route.ts`
- `src/components/features/taxes/YearSelect.tsx` — replaced by `TaxesHeader.tsx`'s year picker
- `src/server/taxes.ts` shim — may be deleted once `/taxes/[year]` replaces `/taxes`; keep for now if legacy `RealizedSale` type is referenced elsewhere, and delete in the final task

---

## Conventions

- Every monetary render goes through `<SensitiveValue>` (CLAUDE.md).
- Destructive actions (Unseal year) use `ConfirmModal`.
- Tables use `DataTable`. Buttons use `Button` (variant `"default"` / `"danger"`).
- Per-sale and per-dividend row detail uses `DataTable`'s built-in expand capability or a custom detail-row render. If `DataTable` lacks row expansion, add a minimal expand affordance inline in the cell (details row can be rendered via the same component returning a `{row, expanded}` tuple or via a secondary DataTable instance). Keep in primitive scope — no new toolkit.
- Commit after every passing test. Conventional Commits.
- EUR rounding: `roundEur` from `src/lib/money.ts`.
- ULIDs for all new ids.
- Server Actions: Zod validation → transaction → audit event → `revalidatePath` → discriminated result.

---

## Task 1: Extend `buildTaxReport` with year-end balances

**Files:**
- Modify: `src/server/tax/report.ts`
- Modify: `src/server/tax/__tests__/report.test.ts`

- [ ] **Step 1: Add type field and test assertion**

In `src/server/tax/__tests__/report.test.ts`, add after the existing dividend assertions:

```ts
expect(report.yearEndBalances).toBeDefined();
expect(Array.isArray(report.yearEndBalances)).toBe(true);
const unh = report.yearEndBalances.find((b) => b.isin === "US91324P1021");
expect(unh).toBeUndefined(); // fully sold in 2025
```

(The existing test sells 10 UNH in June 2025 after buying 10 in January, so remainingQty = 0 and the asset is not in year-end balances. That's the assertion.)

- [ ] **Step 2: Run — must fail**

Run: `pnpm test report.test`
Expected: FAIL — `yearEndBalances` undefined.

- [ ] **Step 3: Extend `TaxReport` type and implementation**

In `src/server/tax/report.ts`:

Add export type above `TaxReport`:

```ts
export type YearEndBalance = {
  accountId: string;
  accountName: string | null;
  accountCountry: string | null;
  accountType: string;
  assetId: string;
  assetName: string | null;
  isin: string | null;
  assetClassTax: string | null;
  quantity: number;
  valueEur: number; // quantity × latest asset_valuations.priceEur on or before year-end; 0 if none
};
```

Add `yearEndBalances: YearEndBalance[]` to `TaxReport`.

At the bottom of `buildTaxReport`, before the `return`, compute:

```ts
const yearEndIso = new Date(end - 86_400_000).toISOString().slice(0, 10);
const lotRows = db.select().from(taxLots).all();
const byAccountAsset = new Map<string, { accountId: string; assetId: string; qty: number }>();
for (const lot of lotRows) {
  if (lot.remainingQty <= 1e-9) continue;
  const key = `${lot.accountId}::${lot.assetId}`;
  const cur = byAccountAsset.get(key) ?? { accountId: lot.accountId, assetId: lot.assetId, qty: 0 };
  cur.qty += lot.remainingQty;
  byAccountAsset.set(key, cur);
}
const yearEndBalances: YearEndBalance[] = [];
for (const entry of byAccountAsset.values()) {
  const account = db.select().from(accounts).where(eq(accounts.id, entry.accountId)).get();
  const asset = db.select().from(assets).where(eq(assets.id, entry.assetId)).get();
  const valuation = db
    .select()
    .from(assetValuations)
    .where(and(eq(assetValuations.assetId, entry.assetId), lte(assetValuations.valuationDate, yearEndIso)))
    .orderBy(desc(assetValuations.valuationDate))
    .limit(1)
    .get();
  const valueEur = valuation ? entry.qty * valuation.priceEur : 0;
  yearEndBalances.push({
    accountId: entry.accountId,
    accountName: account?.name ?? null,
    accountCountry: account?.countryCode ?? null,
    accountType: account?.accountType ?? "unknown",
    assetId: entry.assetId,
    assetName: asset?.name ?? null,
    isin: asset?.isin ?? null,
    assetClassTax: asset?.assetClassTax ?? null,
    quantity: entry.qty,
    valueEur,
  });
}
```

Add to return: `yearEndBalances`.

Add imports: `accounts`, `assetValuations`, `desc`, `lte` from drizzle-orm.

- [ ] **Step 4: Run — pass**

`pnpm test report.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/report.ts src/server/tax/__tests__/report.test.ts
git commit -m "feat(tax): surface year-end balances in buildTaxReport"
```

---

## Task 2: `m720.ts` — informational-model status

**Files:**
- Create: `src/server/tax/m720.ts`
- Create: `src/server/tax/__tests__/m720.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { taxYearSnapshots } from "../../../db/schema";
import { computeInformationalModelsStatus, type Model720Block } from "../m720";

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("computeInformationalModelsStatus", () => {
  it("flags a new 720 block when foreign securities cross €50k for the first time", () => {
    const db = makeDb();
    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: 60_000 },
      { country: "ES", type: "broker-securities", valueEur: 10_000 },
      { country: "NL", type: "crypto", valueEur: 30_000 },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("new");
    const es = res.m720.blocks.find((b) => b.country === "ES");
    // ES is Spain — not foreign, skipped entirely.
    expect(es).toBeUndefined();
    const nl = res.m721.blocks.find((b) => b.country === "NL");
    expect(nl?.status).toBe("ok"); // crypto block below €50k → no filing duty
  });

  it("flags delta_20k when a previously-declared block grows by more than €20k", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: 60_000, status: "new" }] },
      }),
    }).run();

    const blocks: Model720Block[] = [
      { country: "IE", type: "broker-securities", valueEur: 85_000 },
    ];
    const res = computeInformationalModelsStatus(db, 2025, blocks);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("delta_20k");
    expect(ie?.lastDeclaredEur).toBe(60_000);
  });

  it("flags full_exit when a previously-declared block drops to zero", () => {
    const db = makeDb();
    db.insert(taxYearSnapshots).values({
      id: ulid(), year: 2024,
      sealedAt: Date.UTC(2025, 0, 1),
      payloadJson: JSON.stringify({
        m720: { blocks: [{ country: "IE", type: "broker-securities", valueEur: 60_000, status: "new" }] },
      }),
    }).run();

    const res = computeInformationalModelsStatus(db, 2025, []);
    const ie = res.m720.blocks.find((b) => b.country === "IE");
    expect(ie?.status).toBe("full_exit");
  });
});
```

- [ ] **Step 2: Run — fail**

`pnpm test m720.test` → FAIL (module not found).

- [ ] **Step 3: Implement `src/server/tax/m720.ts`**

```ts
import { eq, lt } from "drizzle-orm";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";

export type Model720Block = {
  country: string; // ISO-3166 alpha-2
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

function findLastDeclared(
  db: DB,
  year: number,
  match: (b: AnnotatedBlock) => boolean,
): number | null {
  const priorSnapshots = db
    .select()
    .from(taxYearSnapshots)
    .where(lt(taxYearSnapshots.year, year))
    .all();
  // Sort desc by year.
  priorSnapshots.sort((a, b) => b.year - a.year);
  for (const snap of priorSnapshots) {
    try {
      const payload = JSON.parse(snap.payloadJson) as {
        m720?: { blocks?: AnnotatedBlock[] };
        m721?: { blocks?: AnnotatedBlock[] };
        d6?: { blocks?: AnnotatedBlock[] };
      };
      const pools = [
        ...(payload.m720?.blocks ?? []),
        ...(payload.m721?.blocks ?? []),
        ...(payload.d6?.blocks ?? []),
      ];
      const found = pools.find((b) => b && match(b));
      if (found) return found.valueEur;
    } catch {
      continue;
    }
  }
  return null;
}

function annotate(db: DB, year: number, blocks: Model720Block[]): AnnotatedBlock[] {
  const out: AnnotatedBlock[] = [];
  // Current blocks: assign status.
  for (const b of blocks) {
    const lastDeclared = findLastDeclared(db, year, (x) => x.country === b.country && x.type === b.type);
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
  // Exit detection: blocks declared before but absent this year.
  const priorSnapshots = db.select().from(taxYearSnapshots).where(lt(taxYearSnapshots.year, year)).all();
  priorSnapshots.sort((a, b) => b.year - a.year);
  const seenKeys = new Set(out.map((b) => `${b.country}::${b.type}`));
  const exitSeen = new Set<string>();
  for (const snap of priorSnapshots) {
    try {
      const payload = JSON.parse(snap.payloadJson) as {
        m720?: { blocks?: AnnotatedBlock[] };
        m721?: { blocks?: AnnotatedBlock[] };
        d6?: { blocks?: AnnotatedBlock[] };
      };
      const pools = [
        ...(payload.m720?.blocks ?? []),
        ...(payload.m721?.blocks ?? []),
        ...(payload.d6?.blocks ?? []),
      ];
      for (const prior of pools) {
        if (!prior || !prior.country || !prior.type) continue;
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
    } catch {
      continue;
    }
  }
  return out;
}

export function computeInformationalModelsStatus(
  db: DB,
  year: number,
  blocks: Model720Block[],
): InformationalModelsStatus {
  // Spain is domestic — filter out before annotation.
  const foreign = blocks.filter((b) => b.country !== "ES");
  const annotated = annotate(db, year, foreign);
  const m720 = annotated.filter((b) => b.type === "broker-securities" || b.type === "bank-accounts");
  const m721 = annotated.filter((b) => b.type === "crypto");
  const d6 = annotated.filter((b) => b.type === "broker-securities" && b.status !== "ok");
  return { m720: { blocks: m720 }, m721: { blocks: m721 }, d6: { blocks: d6 } };
}
```

- [ ] **Step 4: Run — pass**

`pnpm test m720.test` → PASS all three.

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/m720.ts src/server/tax/__tests__/m720.test.ts
git commit -m "feat(tax): m720/721/D-6 informational-model status engine"
```

---

## Task 3: Aggregate blocks from `yearEndBalances`

**Files:**
- Create: `src/server/tax/m720Aggregate.ts`
- Create: `src/server/tax/__tests__/m720Aggregate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { aggregateBlocksFromBalances } from "../m720Aggregate";
import type { YearEndBalance } from "../report";

const base: Omit<YearEndBalance, "accountId" | "accountName" | "accountType" | "accountCountry" | "assetId" | "assetName" | "isin" | "assetClassTax"> & { accountCountry: string } = {
  accountCountry: "IE",
  quantity: 1,
  valueEur: 0,
};

describe("aggregateBlocksFromBalances", () => {
  it("aggregates securities per account country and asset class", () => {
    const balances: YearEndBalance[] = [
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "x", assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security", quantity: 3, valueEur: 900 },
      { accountId: "a", accountName: "DEGIRO", accountCountry: "NL", accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 200, valueEur: 25_000 },
      { accountId: "b", accountName: "BINANCE", accountCountry: "MT", accountType: "crypto_exchange", assetId: "z", assetName: "BTC", isin: null, assetClassTax: "crypto", quantity: 1, valueEur: 60_000 },
    ];
    const blocks = aggregateBlocksFromBalances(balances);
    const nl = blocks.find((b) => b.country === "NL" && b.type === "broker-securities");
    expect(nl?.valueEur).toBeCloseTo(25_900, 2);
    const mt = blocks.find((b) => b.country === "MT" && b.type === "crypto");
    expect(mt?.valueEur).toBeCloseTo(60_000, 2);
  });

  it("skips balances with no country", () => {
    const blocks = aggregateBlocksFromBalances([
      { accountId: "a", accountName: "X", accountCountry: null, accountType: "broker", assetId: "y", assetName: "VWCE", isin: "IE00BK5BQT80", assetClassTax: "etf", quantity: 1, valueEur: 100 },
    ]);
    expect(blocks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/server/tax/m720Aggregate.ts`**

```ts
import type { YearEndBalance } from "./report";
import type { Model720Block } from "./m720";

export function aggregateBlocksFromBalances(balances: YearEndBalance[]): Model720Block[] {
  const map = new Map<string, Model720Block>();
  for (const b of balances) {
    if (!b.accountCountry) continue;
    const type: Model720Block["type"] =
      b.assetClassTax === "crypto"
        ? "crypto"
        : b.accountType === "bank" || b.accountType === "savings"
          ? "bank-accounts"
          : "broker-securities";
    const key = `${b.accountCountry}::${type}`;
    const cur = map.get(key) ?? { country: b.accountCountry, type, valueEur: 0 };
    cur.valueEur += b.valueEur;
    map.set(key, cur);
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/m720Aggregate.ts src/server/tax/__tests__/m720Aggregate.test.ts
git commit -m "feat(tax): aggregate informational-model blocks from year-end balances"
```

---

## Task 4: `sealYear` / `unsealYear` actions

**Files:**
- Create: `src/actions/sealYear.schema.ts`
- Create: `src/actions/sealYear.ts`
- Create: `src/actions/unsealYear.ts`
- Create: `src/actions/__tests__/sealYear.test.ts`

- [ ] **Step 1: Schema**

```ts
// src/actions/sealYear.schema.ts
import { z } from "zod";
export const sealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  notes: z.string().trim().max(500).optional(),
});
export type SealYearInput = z.input<typeof sealYearSchema>;
export const unsealYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
});
```

- [ ] **Step 2: Write failing test**

```ts
// src/actions/__tests__/sealYear.test.ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions, taxYearSnapshots } from "../../db/schema";
import { recomputeLotsForAsset } from "../../server/tax/lots";
import { sealYear } from "../sealYear";
import { unsealYear } from "../unsealYear";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("sealYear / unsealYear", () => {
  it("seals a year by writing a tax_year_snapshots row", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "VWCE", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const res = await sealYear({ year: 2025 }, db);
    expect(res.ok).toBe(true);
    const row = db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, 2025)).get();
    expect(row).toBeDefined();
    expect(row!.payloadJson.length).toBeGreaterThan(10);
  });

  it("rejects sealing a year already sealed", async () => {
    const db = makeDb();
    const sealed = await sealYear({ year: 2025 }, db);
    expect(sealed.ok).toBe(true);
    const again = await sealYear({ year: 2025 }, db);
    expect(again.ok).toBe(false);
  });

  it("unseals a sealed year", async () => {
    const db = makeDb();
    const sealed = await sealYear({ year: 2025 }, db);
    expect(sealed.ok).toBe(true);
    const unsealed = await unsealYear({ year: 2025 }, db);
    expect(unsealed.ok).toBe(true);
    expect(db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, 2025)).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Implement `src/actions/sealYear.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/actions/unsealYear.ts`**

```ts
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
```

- [ ] **Step 6: Run tests**

`pnpm test sealYear.test` → 3 cases pass.

- [ ] **Step 7: Commit**

```bash
git add src/actions/sealYear.ts src/actions/unsealYear.ts src/actions/sealYear.schema.ts src/actions/__tests__/sealYear.test.ts
git commit -m "feat(tax): sealYear / unsealYear actions"
```

---

## Task 5: `computeDriftSinceSeal` read helper

**Files:**
- Create: `src/server/tax/seals.ts`
- Create: `src/server/tax/__tests__/seals.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import * as schema from "../../../db/schema";
import type { DB } from "../../../db/client";
import { accounts, assets, assetTransactions } from "../../../db/schema";
import { recomputeLotsForAsset } from "../lots";
import { computeDriftSinceSeal, getSnapshot } from "../seals";
import { sealYear } from "../../../actions/sealYear";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("computeDriftSinceSeal", () => {
  it("returns null when no snapshot exists", () => {
    const db = makeDb();
    expect(computeDriftSinceSeal(db, 2025)).toBeNull();
  });

  it("returns null when sealed report matches live report", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "X", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    await sealYear({ year: 2025 }, db);
    expect(computeDriftSinceSeal(db, 2025)).toBeNull();
  });

  it("returns a drift report when post-seal edits change totals", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "X", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: Date.UTC(2025, 0, 1),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });
    await sealYear({ year: 2025 }, db);

    // Post-seal edit: add a sell.
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: Date.UTC(2025, 5, 1),
      quantity: 10, unitPrice: 150, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1500, tradeGrossAmountEur: 1500, cashImpactEur: 1500,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 1500,
      isListed: true, source: "manual",
    }).run();
    db.transaction((tx) => { recomputeLotsForAsset(tx as unknown as DB, assetId); });

    const drift = computeDriftSinceSeal(db, 2025);
    expect(drift).not.toBeNull();
    expect(drift!.netComputableEurDelta).toBeCloseTo(500, 2);
  });

  it("getSnapshot returns the stored snapshot when sealed", async () => {
    const db = makeDb();
    await sealYear({ year: 2025 }, db);
    const snap = getSnapshot(db, 2025);
    expect(snap).not.toBeNull();
    expect(snap!.year).toBe(2025);
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/server/tax/seals.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { taxYearSnapshots } from "../../db/schema";
import { buildTaxReport, type TaxReport } from "./report";

export type Snapshot = {
  year: number;
  sealedAt: number;
  payload: { report: TaxReport; m720?: unknown; m721?: unknown; d6?: unknown };
};

export type DriftReport = {
  year: number;
  netComputableEurDelta: number;
  dividendsGrossEurDelta: number;
  withholdingOrigenTotalEurDelta: number;
  nonComputableLossesEurDelta: number;
  salesCountDelta: number;
  dividendsCountDelta: number;
};

export function getSnapshot(db: DB, year: number): Snapshot | null {
  const row = db.select().from(taxYearSnapshots).where(eq(taxYearSnapshots.year, year)).get();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payloadJson) as Snapshot["payload"];
    return { year: row.year, sealedAt: row.sealedAt, payload };
  } catch {
    return null;
  }
}

export function computeDriftSinceSeal(db: DB, year: number): DriftReport | null {
  const snap = getSnapshot(db, year);
  if (!snap) return null;
  const live = buildTaxReport(db, year);
  const sealed = snap.payload.report;
  const drift: DriftReport = {
    year,
    netComputableEurDelta: round(live.totals.netComputableEur - sealed.totals.netComputableEur),
    dividendsGrossEurDelta: round(live.totals.dividendsGrossEur - sealed.totals.dividendsGrossEur),
    withholdingOrigenTotalEurDelta: round(live.totals.withholdingOrigenTotalEur - sealed.totals.withholdingOrigenTotalEur),
    nonComputableLossesEurDelta: round(live.totals.nonComputableLossesEur - sealed.totals.nonComputableLossesEur),
    salesCountDelta: live.sales.length - sealed.sales.length,
    dividendsCountDelta: live.dividends.length - sealed.dividends.length,
  };
  if (
    drift.netComputableEurDelta === 0 &&
    drift.dividendsGrossEurDelta === 0 &&
    drift.withholdingOrigenTotalEurDelta === 0 &&
    drift.nonComputableLossesEurDelta === 0 &&
    drift.salesCountDelta === 0 &&
    drift.dividendsCountDelta === 0
  ) {
    return null;
  }
  return drift;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: Run tests**

`pnpm test seals.test` → 4 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/seals.ts src/server/tax/__tests__/seals.test.ts
git commit -m "feat(tax): getSnapshot and computeDriftSinceSeal"
```

---

## Task 6: `/taxes/[year]` route + redirect shim

**Files:**
- Create: `src/app/taxes/[year]/page.tsx` (initial skeleton)
- Modify: `src/app/taxes/page.tsx` — becomes redirect
- Create: `src/app/taxes/[year]/not-found.tsx` (optional; skip unless linter complains)

- [ ] **Step 1: Replace `src/app/taxes/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getTaxYears } from "@/src/server/taxes";

export const dynamic = "force-dynamic";

export default async function TaxesIndex() {
  const years = await getTaxYears();
  const now = new Date().getUTCFullYear();
  const target = years[0] ?? now;
  redirect(`/taxes/${target}`);
}
```

- [ ] **Step 2: Create `src/app/taxes/[year]/page.tsx` skeleton**

```tsx
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { buildTaxReport } from "@/src/server/tax/report";
import { computeDriftSinceSeal, getSnapshot } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { getTaxYears } from "@/src/server/taxes";
import { db } from "@/src/db/client";

type Params = Promise<{ year: string }>;

export default async function TaxYearPage({ params }: { params: Params }) {
  const { year: yearStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(year)) notFound();

  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const blocks = aggregateBlocksFromBalances(report.yearEndBalances);
  const models = snapshot
    ? { m720: (snapshot.payload as { m720: unknown }).m720, m721: (snapshot.payload as { m721: unknown }).m721, d6: (snapshot.payload as { d6: unknown }).d6 }
    : computeInformationalModelsStatus(db, year, blocks);
  const drift = computeDriftSinceSeal(db, year);
  const years = await getTaxYears();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Taxes — {year}</h1>
        <p className="text-sm text-muted-foreground">
          {snapshot ? `Sealed on ${new Date(snapshot.sealedAt).toISOString().slice(0, 10)}` : "Unsealed — live data"}
        </p>
      </header>
      {/* Subsequent tasks add KPIs, tables, seal button, etc. */}
      <pre className="text-xs opacity-60">{JSON.stringify({ year, totals: report.totals, models, drift, yearsAvailable: years }, null, 2)}</pre>
    </div>
  );
}
```

- [ ] **Step 3: Verify routing**

`pnpm dev` (if a dev server isn't already running). Visit `/taxes` → should redirect to `/taxes/<current-year>`. Visit `/taxes/2025` → renders skeleton with totals JSON.

- [ ] **Step 4: Commit**

```bash
git add src/app/taxes/
git commit -m "feat(taxes): dynamic /taxes/[year] route with redirect from /taxes"
```

---

## Task 7: `TaxesHeader` — year picker + export dropdown

**Files:**
- Create: `src/components/features/taxes/TaxesHeader.tsx`
- Create: `src/components/features/taxes/ExportMenu.tsx`
- Modify: `src/app/taxes/[year]/page.tsx` — wire the header

- [ ] **Step 1: `ExportMenu.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/Button";

type Props = { year: number };

export function ExportMenu({ year }: Props) {
  const [open, setOpen] = useState(false);
  const items: { label: string; href: string }[] = [
    { label: "PDF report", href: `/api/exports/tax/pdf?year=${year}` },
    { label: "Casillas CSV (Modelo 100 paste)", href: `/api/exports/tax/casillas?year=${year}` },
    { label: "Detail CSV (comprobación dossier)", href: `/api/exports/tax/detail?year=${year}` },
    { label: "Modelo 720 diff (JSON)", href: `/api/exports/tax/m720-diff?year=${year}&format=json` },
  ];
  return (
    <div className="relative">
      <Button onClick={() => setOpen((s) => !s)}>Export ▾</Button>
      {open ? (
        <div className="absolute right-0 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-lg z-10">
          {items.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `TaxesHeader.tsx`**

```tsx
import Link from "next/link";
import { ExportMenu } from "./ExportMenu";
import { SealYearButton } from "./SealYearButton";
import { UnsealYearButton } from "./UnsealYearButton";

type Props = {
  year: number;
  availableYears: number[];
  sealed: boolean;
};

export function TaxesHeader({ year, availableYears, sealed }: Props) {
  const years = [...new Set([year, ...availableYears])].sort((a, b) => b - a);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Taxes — {year}</h1>
        <p className="text-sm text-muted-foreground">
          Realized gains, dividends, informational-model status.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border p-1">
          {years.map((y) => (
            <Link
              key={y}
              href={`/taxes/${y}`}
              className={[
                "rounded-md px-3 py-1 text-sm",
                y === year ? "bg-accent font-medium" : "hover:bg-accent/40",
              ].join(" ")}
            >
              {y}
            </Link>
          ))}
        </div>
        {sealed ? <UnsealYearButton year={year} /> : <SealYearButton year={year} />}
        <ExportMenu year={year} />
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Stub `SealYearButton` / `UnsealYearButton`**

Create both as client components under `src/components/features/taxes/`. Full impl in Task 8.

```tsx
// SealYearButton.tsx
"use client";
import { Button } from "@/src/components/ui/Button";
type Props = { year: number };
export function SealYearButton({ year: _year }: Props) {
  return <Button disabled>Seal year</Button>;
}
```

```tsx
// UnsealYearButton.tsx
"use client";
import { Button } from "@/src/components/ui/Button";
type Props = { year: number };
export function UnsealYearButton({ year: _year }: Props) {
  return <Button variant="danger" disabled>Unseal year</Button>;
}
```

- [ ] **Step 4: Wire header into page**

Replace the header block in `src/app/taxes/[year]/page.tsx` with:

```tsx
import { TaxesHeader } from "@/src/components/features/taxes/TaxesHeader";
// ...
<TaxesHeader year={year} availableYears={years} sealed={snapshot != null} />
```

- [ ] **Step 5: Typecheck, visually inspect in dev**

`pnpm typecheck` clean. `/taxes/2025` shows picker + disabled seal + export dropdown.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/taxes/ src/app/taxes/
git commit -m "feat(taxes): TaxesHeader with year picker and export dropdown"
```

---

## Task 8: Seal button + confirm modal + drift banner

**Files:**
- Modify: `src/components/features/taxes/SealYearButton.tsx`
- Modify: `src/components/features/taxes/UnsealYearButton.tsx`
- Create: `src/components/features/taxes/DriftBanner.tsx`
- Modify: `src/app/taxes/[year]/page.tsx`

- [ ] **Step 1: Implement `SealYearButton`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/Button";
import { ConfirmModal } from "@/src/components/ui/ConfirmModal";
import { sealYear } from "@/src/actions/sealYear";

type Props = { year: number };

export function SealYearButton({ year }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await sealYear({ year });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={pending}>Seal year</Button>
      <ConfirmModal
        open={open}
        title={`Seal ${year}?`}
        description={
          <div className="space-y-2">
            <p>
              Sealing writes a snapshot of this year&apos;s tax report. Later edits to
              transactions in {year} will produce a drift indicator instead of changing
              the filed numbers silently.
            </p>
            {error ? <p className="text-destructive">{error}</p> : null}
          </div>
        }
        confirmLabel="Seal"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: Implement `UnsealYearButton`**

Same skeleton, calls `unsealYear`, danger variant, title "Unseal year?", description warns about losing the snapshot.

- [ ] **Step 3: Implement `DriftBanner`**

```tsx
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { DriftReport } from "@/src/server/tax/seals";

export function DriftBanner({ drift }: { drift: DriftReport }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">
        Drift detected since this year was sealed
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>
          Net computable:{" "}
          <SensitiveValue>{formatEur(drift.netComputableEurDelta)}</SensitiveValue>
        </li>
        <li>
          Dividends gross:{" "}
          <SensitiveValue>{formatEur(drift.dividendsGrossEurDelta)}</SensitiveValue>
        </li>
        <li>
          Retención origen total:{" "}
          <SensitiveValue>
            {formatEur(drift.withholdingOrigenTotalEurDelta)}
          </SensitiveValue>
        </li>
        <li>Sales count Δ: {drift.salesCountDelta}</li>
        <li>Dividends count Δ: {drift.dividendsCountDelta}</li>
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Either accept the edit (unseal and reseal) or revert the change in /transactions.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Wire drift banner into page**

In `src/app/taxes/[year]/page.tsx`, after the header, insert:

```tsx
{drift ? <DriftBanner drift={drift} /> : null}
```

- [ ] **Step 5: Run tests and typecheck**

`pnpm typecheck && pnpm test sealYear.test seals.test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/taxes/ src/app/taxes/
git commit -m "feat(taxes): seal/unseal buttons and drift banner"
```

---

## Task 9: `TaxKpiRow` — 7 KPI cards

**Files:**
- Create: `src/components/features/taxes/TaxKpiRow.tsx`
- Modify: `src/app/taxes/[year]/page.tsx`

- [ ] **Step 1: Implement KPI row**

```tsx
import { KPICard } from "@/src/components/ui/KPICard";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { TaxReport } from "@/src/server/tax/report";

export function TaxKpiRow({ report, interestEur }: { report: TaxReport; interestEur: number }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <KPICard label="Realized gains" value={<SensitiveValue>{formatEur(report.totals.realizedGainsEur)}</SensitiveValue>} />
      <KPICard label="Realized losses (computable)" value={<SensitiveValue>{formatEur(report.totals.realizedLossesComputableEur)}</SensitiveValue>} />
      <KPICard label="Non-computable losses (art. 33.5)" value={<SensitiveValue>{formatEur(report.totals.nonComputableLossesEur)}</SensitiveValue>} />
      <KPICard label="Net computable" value={<SensitiveValue>{formatEur(report.totals.netComputableEur)}</SensitiveValue>} />
      <KPICard label="Dividends gross" value={<SensitiveValue>{formatEur(report.totals.dividendsGrossEur)}</SensitiveValue>} />
      <KPICard label="Retención (origen)" value={<SensitiveValue>{formatEur(report.totals.withholdingOrigenTotalEur)}</SensitiveValue>} />
      <KPICard label="Interest (informational · Modelo 196)" value={<SensitiveValue>{formatEur(interestEur)}</SensitiveValue>} />
    </section>
  );
}
```

- [ ] **Step 2: Fetch interest in the page and render the row**

In `src/app/taxes/[year]/page.tsx`, import `computeDividendAndInterestForYear` from `src/server/taxes`. Inside the page body:

```tsx
const dividendAndInterest = await computeDividendAndInterestForYear(year);
// ...
<TaxKpiRow report={report} interestEur={dividendAndInterest.interestEur} />
```

`KPICard` accepts `value` as string or ReactNode. If it currently only accepts string, adapt it to accept `string | ReactNode` — minimal widening, keep callers working.

- [ ] **Step 3: Typecheck + visual**

`pnpm typecheck` → clean. `/taxes/2025` shows 7 KPI cards.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/taxes/TaxKpiRow.tsx src/app/taxes/[year]/page.tsx src/components/ui/KPICard.tsx
git commit -m "feat(taxes): 7-card KPI row with raw and computable totals"
```

---

## Task 10: `GainsTable` — sales with lot expansion

**Files:**
- Create: `src/components/features/taxes/GainsTable.tsx`
- Create: `src/components/features/taxes/GainsLotDetail.tsx`
- Modify: `src/app/taxes/[year]/page.tsx`

- [ ] **Step 1: Implement `GainsLotDetail`**

```tsx
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { SaleReportRow } from "@/src/server/tax/report";

export function GainsLotDetail({ sale }: { sale: SaleReportRow }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm">
      <div className="mb-2 font-medium">FIFO lots consumed</div>
      <table className="w-full">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left">Acquired</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Cost basis (EUR)</th>
          </tr>
        </thead>
        <tbody>
          {sale.consumedLots.map((l) => (
            <tr key={l.lotId} className="border-t border-border/20">
              <td>{formatDate(l.acquiredAt)}</td>
              <td className="text-right tabular-nums">{l.qtyConsumed.toFixed(6)}</td>
              <td className="text-right tabular-nums">
                <SensitiveValue>{formatEur(l.costBasisEur)}</SensitiveValue>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sale.nonComputableLossEur > 0 ? (
        <div className="mt-2 text-destructive">
          Wash-sale (art. 33.5.f/g): non-computable portion{" "}
          <SensitiveValue>{formatEur(sale.nonComputableLossEur)}</SensitiveValue>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Implement `GainsTable` with expandable rows**

```tsx
"use client";

import { useState } from "react";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { Card } from "@/src/components/ui/Card";
import { formatDate, formatEur } from "@/src/lib/format";
import type { SaleReportRow } from "@/src/server/tax/report";
import { GainsLotDetail } from "./GainsLotDetail";

type Props = { sales: SaleReportRow[] };

export function GainsTable({ sales }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  if (sales.length === 0) {
    return (
      <Card title="Ganancias patrimoniales">
        <p className="text-sm text-muted-foreground p-4">No sales this year.</p>
      </Card>
    );
  }
  return (
    <Card title={`Ganancias patrimoniales (${sales.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th></th>
              <th className="text-left">Date</th>
              <th className="text-left">Asset</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Proceeds</th>
              <th className="text-right">Cost basis</th>
              <th className="text-right">Fees</th>
              <th className="text-right">Gross G/L</th>
              <th className="text-right">Non-comp.</th>
              <th className="text-right">Computable</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const isOpen = expanded.has(s.transactionId);
              return (
                <>
                  <tr key={s.transactionId} className="border-t border-border/30 align-top">
                    <td>
                      <button
                        className="px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => toggle(s.transactionId)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>{formatDate(s.tradedAt)}</td>
                    <td>{s.assetName ?? s.assetId}</td>
                    <td className="text-right tabular-nums">{s.quantity.toFixed(6)}</td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.proceedsEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.costBasisEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.feesEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.rawGainLossEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.nonComputableLossEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      <SensitiveValue>{formatEur(s.computableGainLossEur)}</SensitiveValue>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td></td>
                      <td colSpan={9} className="pb-3">
                        <GainsLotDetail sale={s} />
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Add to page**

```tsx
<GainsTable sales={report.sales} />
```

- [ ] **Step 4: Typecheck + visual verification**

`pnpm typecheck`. Click a sale row → lots appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/taxes/ src/app/taxes/[year]/page.tsx
git commit -m "feat(taxes): realised-sales table with FIFO lot expansion"
```

---

## Task 11: `DividendsTable` with country + retenciones

**Files:**
- Create: `src/components/features/taxes/DividendsTable.tsx`
- Modify: `src/app/taxes/[year]/page.tsx`

- [ ] **Step 1: Implement the table**

```tsx
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { DividendReportRow } from "@/src/server/tax/report";
import { ddiTreatyRate } from "@/src/server/tax/countries";

export function DividendsTable({ dividends }: { dividends: DividendReportRow[] }) {
  if (dividends.length === 0) {
    return (
      <Card title="Rendimientos del capital mobiliario">
        <p className="text-sm text-muted-foreground p-4">No dividends this year.</p>
      </Card>
    );
  }
  return (
    <Card title={`Rendimientos del capital mobiliario (${dividends.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Date</th>
              <th className="text-left">Asset</th>
              <th className="text-left">Country</th>
              <th className="text-right">Gross</th>
              <th className="text-right">Ret. origen</th>
              <th className="text-right">Ret. destino</th>
              <th className="text-right">Net</th>
              <th className="text-right">DDI cap</th>
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => {
              const cap = d.sourceCountry ? ddiTreatyRate(d.sourceCountry) : 0.15;
              const ddiCreditable = Math.min(d.withholdingOrigenEur, cap * d.grossEur);
              return (
                <tr key={d.transactionId} className="border-t border-border/30">
                  <td>{formatDate(d.tradedAt)}</td>
                  <td>{d.assetName ?? d.assetId}</td>
                  <td>{d.sourceCountry ?? "—"}</td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(d.grossEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(d.withholdingOrigenEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(d.withholdingDestinoEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums font-medium">
                    <SensitiveValue>{formatEur(d.netEur)}</SensitiveValue>
                  </td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(ddiCreditable)}</SensitiveValue>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into page**

```tsx
<DividendsTable dividends={report.dividends} />
```

- [ ] **Step 3: Typecheck + visual**

- [ ] **Step 4: Commit**

```bash
git add src/components/features/taxes/DividendsTable.tsx src/app/taxes/[year]/page.tsx
git commit -m "feat(taxes): dividends table with country, retenciones, DDI credit cap"
```

---

## Task 12: `YearEndCard` — 720/721/D-6 status

**Files:**
- Create: `src/components/features/taxes/YearEndCard.tsx`
- Modify: `src/app/taxes/[year]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { AnnotatedBlock, InformationalModelsStatus } from "@/src/server/tax/m720";

const STATUS_COLORS: Record<AnnotatedBlock["status"], string> = {
  ok: "bg-muted text-muted-foreground",
  new: "bg-amber-500/20 text-amber-300",
  delta_20k: "bg-amber-500/20 text-amber-300",
  full_exit: "bg-blue-500/20 text-blue-300",
};

function BlockList({ title, blocks }: { title: string; blocks: AnnotatedBlock[] }) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-border/40 p-4">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">No foreign blocks in scope.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/40 p-4">
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 space-y-2">
        {blocks.map((b, i) => (
          <li key={`${b.country}-${b.type}-${i}`} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{b.country}</span>
              <span className="text-xs text-muted-foreground">{b.type}</span>
              <Badge className={STATUS_COLORS[b.status]}>{b.status}</Badge>
            </div>
            <div className="text-sm tabular-nums">
              <SensitiveValue>{formatEur(b.valueEur)}</SensitiveValue>
              {b.lastDeclaredEur != null ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  was <SensitiveValue>{formatEur(b.lastDeclaredEur)}</SensitiveValue>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function YearEndCard({ models }: { models: InformationalModelsStatus }) {
  return (
    <Card title="Year-end informational models">
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <BlockList title="Modelo 720 (foreign securities + accounts)" blocks={models.m720.blocks} />
        <BlockList title="Modelo 721 (foreign crypto)" blocks={models.m721.blocks} />
        <BlockList title="Modelo D-6 (foreign listed securities)" blocks={models.d6.blocks} />
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into page**

```tsx
<YearEndCard models={models} />
```

Make sure the `models` value has the correct `InformationalModelsStatus` shape even when read from a sealed snapshot. Coerce via `models as InformationalModelsStatus` if needed, but only if the snapshot payload already contains that shape (it does — Task 4 stores it that way).

- [ ] **Step 3: Typecheck + visual**

- [ ] **Step 4: Commit**

```bash
git add src/components/features/taxes/YearEndCard.tsx src/app/taxes/[year]/page.tsx
git commit -m "feat(taxes): year-end 720/721/D-6 block card with refile flags"
```

---

## Task 13: `createSwap` action

**Files:**
- Create: `src/actions/createSwap.schema.ts`
- Create: `src/actions/createSwap.ts`
- Create: `src/actions/__tests__/createSwap.test.ts`

- [ ] **Step 1: Schema**

```ts
// src/actions/createSwap.schema.ts
import { z } from "zod";
export const createSwapSchema = z.object({
  accountId: z.string().min(1),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-MM-dd"),
  outgoingAssetId: z.string().min(1),
  outgoingQuantity: z.number().positive(),
  incomingAssetId: z.string().min(1),
  incomingQuantity: z.number().positive(),
  valueEur: z.number().positive(),
  feeAssetId: z.string().min(1).optional(),
  feeQuantity: z.number().nonnegative().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSwapInput = z.input<typeof createSwapSchema>;
```

- [ ] **Step 2: Write failing test**

```ts
// src/actions/__tests__/createSwap.test.ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions } from "../../db/schema";
import { createSwap } from "../createSwap";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("createSwap", () => {
  it("creates two linked asset_transactions with identical EUR value", async () => {
    const db = makeDb();
    const accountId = ulid(); const btc = ulid(); const eth = ulid();
    db.insert(accounts).values({ id: accountId, name: "BINANCE", currency: "EUR", accountType: "crypto_exchange", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: btc, name: "BTC", assetType: "crypto", currency: "BTC", isActive: true, assetClassTax: "crypto" }).run();
    db.insert(assets).values({ id: eth, name: "ETH", assetType: "crypto", currency: "ETH", isActive: true, assetClassTax: "crypto" }).run();

    // Seed a BTC lot.
    db.insert(assetTransactions).values({
      id: ulid(), accountId, assetId: btc,
      transactionType: "buy", tradedAt: Date.UTC(2024, 5, 1),
      quantity: 0.5, unitPrice: 30000,
      tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 15000, tradeGrossAmountEur: 15000, cashImpactEur: -15000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -15000,
      isListed: false, source: "manual",
    }).run();

    const result = await createSwap({
      accountId, tradeDate: "2025-03-15",
      outgoingAssetId: btc, outgoingQuantity: 0.1,
      incomingAssetId: eth, incomingQuantity: 1.8,
      valueEur: 4500,
    }, db);

    expect(result.ok).toBe(true);
    const sellLeg = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, btc)).all().find((t) => t.transactionType === "sell");
    const buyLeg = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, eth)).all().find((t) => t.transactionType === "buy");
    expect(sellLeg).toBeDefined();
    expect(buyLeg).toBeDefined();
    expect(sellLeg!.tradeGrossAmountEur).toBe(4500);
    expect(buyLeg!.tradeGrossAmountEur).toBe(4500);
    expect(sellLeg!.linkedTransactionId).toBe(buyLeg!.id);
    expect(buyLeg!.linkedTransactionId).toBe(sellLeg!.id);
  });

  it("rejects when outgoing or incoming asset not found", async () => {
    const db = makeDb();
    const result = await createSwap({
      accountId: "nonexistent", tradeDate: "2025-03-15",
      outgoingAssetId: "a", outgoingQuantity: 1,
      incomingAssetId: "b", incomingQuantity: 1,
      valueEur: 100,
    }, db);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Implement `src/actions/createSwap.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents } from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { createSwapSchema } from "./createSwap.schema";
import { ACTOR, type ActionResult } from "./_shared";

export async function createSwap(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ sellId: string; buyId: string }>> {
  const parsed = createSwapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
  const data = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const outgoing = tx.select().from(assets).where(eq(assets.id, data.outgoingAssetId)).get();
      if (!outgoing) throw new Error("outgoing asset not found");
      const incoming = tx.select().from(assets).where(eq(assets.id, data.incomingAssetId)).get();
      if (!incoming) throw new Error("incoming asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const sellId = ulid();
      const buyId = ulid();
      const valueEur = data.valueEur;

      tx.insert(assetTransactions).values({
        id: sellId, accountId: data.accountId, assetId: data.outgoingAssetId,
        transactionType: "sell", tradedAt,
        quantity: data.outgoingQuantity,
        unitPrice: valueEur / data.outgoingQuantity,
        tradeCurrency: outgoing.currency, fxRateToEur: 1,
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: valueEur,
        linkedTransactionId: buyId,
        isListed: false, source: "manual",
        notes: data.notes ?? `swap → ${incoming.name}`,
      }).run();

      tx.insert(assetTransactions).values({
        id: buyId, accountId: data.accountId, assetId: data.incomingAssetId,
        transactionType: "buy", tradedAt,
        quantity: data.incomingQuantity,
        unitPrice: valueEur / data.incomingQuantity,
        tradeCurrency: incoming.currency, fxRateToEur: 1,
        tradeGrossAmount: valueEur, tradeGrossAmountEur: valueEur,
        cashImpactEur: -valueEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: -valueEur,
        linkedTransactionId: sellId,
        isListed: false, source: "manual",
        notes: data.notes ?? `swap ← ${outgoing.name}`,
      }).run();

      recomputeLotsForAsset(tx, data.outgoingAssetId);
      recomputeLotsForAsset(tx, data.incomingAssetId);

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: sellId,
        action: "create-swap",
        actorType: "user",
        source: "ui",
        summary: `swap ${data.outgoingQuantity} ${outgoing.name} → ${data.incomingQuantity} ${incoming.name}`,
        previousJson: null,
        nextJson: JSON.stringify({ sellId, buyId, valueEur }),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { sellId, buyId };
    });

    revalidatePath("/transactions");
    revalidatePath("/accounts");
    revalidatePath("/overview");
    revalidatePath("/taxes");
    revalidatePath("/assets");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
```

- [ ] **Step 5: Run tests**

`pnpm test createSwap.test` → 2 pass.

- [ ] **Step 6: Commit**

```bash
git add src/actions/createSwap.ts src/actions/createSwap.schema.ts src/actions/__tests__/createSwap.test.ts
git commit -m "feat(tx): createSwap action with linked buy+sell and EUR parity"
```

---

## Task 14: `createDividend` action

**Files:**
- Create: `src/actions/createDividend.schema.ts`
- Create: `src/actions/createDividend.ts`
- Create: `src/actions/__tests__/createDividend.test.ts`

- [ ] **Step 1: Schema**

```ts
// src/actions/createDividend.schema.ts
import { z } from "zod";
export const createDividendSchema = z.object({
  accountId: z.string().min(1),
  assetId: z.string().min(1),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossNative: z.number().positive(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  fxRateToEur: z.number().positive().optional(),
  withholdingOrigenNative: z.number().nonnegative().default(0),
  withholdingDestinoEur: z.number().nonnegative().default(0),
  sourceCountry: z.string().trim().regex(/^[A-Z]{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateDividendInput = z.input<typeof createDividendSchema>;
```

- [ ] **Step 2: Write failing test**

```ts
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import { accounts, assets, assetTransactions } from "../../db/schema";
import { createDividend } from "../createDividend";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

function makeDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return db;
}

describe("createDividend", () => {
  it("writes a dividend asset_transactions row with retenciones and source country", async () => {
    const db = makeDb();
    const accountId = ulid(); const assetId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
    db.insert(assets).values({ id: assetId, name: "UNH", assetType: "equity", isin: "US91324P1021", currency: "USD", isActive: true, assetClassTax: "listed_security" }).run();

    const result = await createDividend({
      accountId, assetId,
      tradeDate: "2025-03-17",
      grossNative: 6.63,
      currency: "USD",
      fxRateToEur: 0.92,
      withholdingOrigenNative: 0.99,
      withholdingDestinoEur: 0,
      sourceCountry: "US",
    }, db);

    expect(result.ok).toBe(true);
    const row = db.select().from(assetTransactions).where(eq(assetTransactions.assetId, assetId)).get();
    expect(row?.transactionType).toBe("dividend");
    expect(row?.sourceCountry).toBe("US");
    expect(row?.withholdingTax).toBeCloseTo(0.99 * 0.92, 4);
    expect(row?.tradeGrossAmountEur).toBeCloseTo(6.63 * 0.92, 4);
  });
});
```

- [ ] **Step 3: Run — fail**

- [ ] **Step 4: Implement `src/actions/createDividend.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, assets, assetTransactions, auditEvents } from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { roundEur } from "../lib/money";
import { createDividendSchema } from "./createDividend.schema";
import { ACTOR, type ActionResult } from "./_shared";

export async function createDividend(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createDividendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "validation", message: "invalid input" } };
  const data = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const account = tx.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
      if (!account) throw new Error("account not found");
      const asset = tx.select().from(assets).where(eq(assets.id, data.assetId)).get();
      if (!asset) throw new Error("asset not found");

      const tradedAt = new Date(`${data.tradeDate}T12:00:00.000Z`).getTime();
      const fxRate = data.fxRateToEur ?? 1;
      const grossEur = roundEur(data.grossNative * fxRate);
      const whtOrigenEur = roundEur(data.withholdingOrigenNative * fxRate);
      const whtDestinoEur = roundEur(data.withholdingDestinoEur);
      const netEur = roundEur(grossEur - whtOrigenEur - whtDestinoEur);

      const id = ulid();
      tx.insert(assetTransactions).values({
        id, accountId: data.accountId, assetId: data.assetId,
        transactionType: "dividend", tradedAt,
        quantity: 0, unitPrice: 0,
        tradeCurrency: data.currency, fxRateToEur: fxRate,
        tradeGrossAmount: data.grossNative, tradeGrossAmountEur: grossEur,
        cashImpactEur: netEur,
        feesAmount: 0, feesAmountEur: 0, netAmountEur: netEur,
        dividendGross: data.grossNative,
        dividendNet: data.grossNative - data.withholdingOrigenNative,
        withholdingTax: whtOrigenEur,
        withholdingTaxDestination: whtDestinoEur,
        sourceCountry: data.sourceCountry ?? null,
        isListed: true, source: "manual",
        notes: data.notes ?? null,
      }).run();

      recomputeLotsForAsset(tx, data.assetId);

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "asset_transaction",
        entityId: id,
        action: "create-dividend",
        actorType: "user",
        source: "ui",
        summary: `dividend ${data.grossNative} ${data.currency} on ${asset.name}`,
        previousJson: null,
        nextJson: JSON.stringify({ id, grossEur, whtOrigenEur }),
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { id };
    });

    revalidatePath("/transactions");
    revalidatePath("/overview");
    revalidatePath("/taxes");
    return { ok: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: { code: "db", message } };
  }
}
```

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add src/actions/createDividend.ts src/actions/createDividend.schema.ts src/actions/__tests__/createDividend.test.ts
git commit -m "feat(tx): createDividend action with retención origen/destino and source country"
```

---

## Task 15: `CreateSwapModal` + `CreateDividendModal` UI

**Files:**
- Create: `src/components/features/transactions/CreateSwapModal.tsx`
- Create: `src/components/features/transactions/CreateDividendModal.tsx`
- Modify: whichever transactions-page header exposes "Add transaction" buttons — add two new buttons opening these modals

- [ ] **Step 1: Scaffold `CreateSwapModal`**

Read `src/components/features/transactions/` to find an existing modal (e.g., the trade create modal) and mirror its structure. The modal accepts `{ accounts, assets, open, onClose }`. Fields: account (select), tradeDate (date), outgoingAssetId (select), outgoingQuantity (number), incomingAssetId (select), incomingQuantity (number), valueEur (number). Submit calls `createSwap`. Display error on `ok:false`.

Full implementation below — adapt import paths / primitive names to the existing codebase:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createSwap } from "@/src/actions/createSwap";

type Props = {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string }[];
  assets: { id: string; name: string }[];
};

export function CreateSwapModal({ open, onClose, accounts, assets }: Props) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10));
  const [outgoingAssetId, setOutgoingAssetId] = useState(assets[0]?.id ?? "");
  const [incomingAssetId, setIncomingAssetId] = useState(assets[1]?.id ?? "");
  const [outgoingQuantity, setOutgoingQuantity] = useState("");
  const [incomingQuantity, setIncomingQuantity] = useState("");
  const [valueEur, setValueEur] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createSwap({
        accountId, tradeDate,
        outgoingAssetId, outgoingQuantity: Number(outgoingQuantity),
        incomingAssetId, incomingQuantity: Number(incomingQuantity),
        valueEur: Number(valueEur),
      });
      if (!result.ok) { setError(result.error.message); return; }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Record crypto swap">
      <div className="flex flex-col gap-3 p-4">
        <label className="text-sm">Account
          <select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Date
          <input type="date" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Outgoing asset
            <select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={outgoingAssetId} onChange={(e) => setOutgoingAssetId(e.target.value)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Outgoing quantity
            <input type="number" step="any" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={outgoingQuantity} onChange={(e) => setOutgoingQuantity(e.target.value)} />
          </label>
          <label className="text-sm">Incoming asset
            <select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={incomingAssetId} onChange={(e) => setIncomingAssetId(e.target.value)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Incoming quantity
            <input type="number" step="any" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={incomingQuantity} onChange={(e) => setIncomingQuantity(e.target.value)} />
          </label>
        </div>
        <label className="text-sm">EUR value at swap
          <input type="number" step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" value={valueEur} onChange={(e) => setValueEur(e.target.value)} />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !accountId || !outgoingAssetId || !incomingAssetId}>Record swap</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Scaffold `CreateDividendModal`**

Same pattern, fields: account, asset, date, grossNative, currency, fxRateToEur (optional — default 1 for EUR), withholdingOrigenNative, withholdingDestinoEur, sourceCountry. Calls `createDividend`.

- [ ] **Step 3: Add trigger buttons on transactions page**

In `src/app/transactions/page.tsx` (or its header component), add two buttons: "Record swap" and "Record dividend". Use `useState` for modal open flags. Server Components can't host useState — put the trigger cluster in a client component `TransactionsHeaderActions.tsx` that renders both modals inline.

- [ ] **Step 4: Typecheck + smoke**

`pnpm typecheck`. Open the page, click each button, fill a form, submit, verify the new row.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/transactions/ src/app/transactions/
git commit -m "feat(tx): CreateSwapModal and CreateDividendModal"
```

---

## Task 16: FX rate column on `/transactions`

**Files:**
- Modify: `src/app/transactions/page.tsx`

- [ ] **Step 1: Read the current column list**

Open `src/app/transactions/page.tsx` and find the `columns` array passed to `DataTable`. Locate where `fxRateToEur` would sit logically (near currency or price).

- [ ] **Step 2: Add a new column**

```tsx
{
  key: "fx",
  header: "FX → EUR",
  align: "right",
  cell: (r) => (
    <span className="tabular-nums text-xs text-muted-foreground">
      {r.tradeCurrency === "EUR" ? "—" : r.fxRateToEur.toFixed(6)}
    </span>
  ),
},
```

Place between the `currency` column and the `amount` column.

- [ ] **Step 3: Typecheck + visual**

- [ ] **Step 4: Commit**

```bash
git add src/app/transactions/page.tsx
git commit -m "feat(transactions): show FX rate per row for cross-currency trades"
```

---

## Task 17: Casillas CSV export

**Files:**
- Create: `src/lib/exports/tax-casillas.ts`
- Create: `src/lib/exports/__tests__/tax-casillas.test.ts`
- Create: `src/app/api/exports/tax/casillas/route.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildCasillasCsv } from "../tax-casillas";
import type { TaxReport } from "@/src/server/tax/report";

const sample = (overrides?: Partial<TaxReport["totals"]>): TaxReport => ({
  year: 2025,
  sales: [],
  dividends: [],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: 500,
    realizedLossesComputableEur: -100,
    nonComputableLossesEur: 40,
    netComputableEur: 400,
    proceedsEur: 1500,
    costBasisEur: 1100,
    feesEur: 0,
    dividendsGrossEur: 120,
    withholdingOrigenTotalEur: 18,
    withholdingDestinoTotalEur: 0,
    ...overrides,
  },
});

describe("buildCasillasCsv", () => {
  it("emits one row per casilla with pipe separator and UTF-8 BOM", () => {
    const csv = buildCasillasCsv(sample());
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("0326");
    expect(csv).toContain("0027");
    expect(csv).toContain("0588");
    // Net computable 400 → casilla 0343.
    expect(csv).toContain("0343|400");
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement `src/lib/exports/tax-casillas.ts`**

```ts
import type { TaxReport } from "@/src/server/tax/report";
import { ddiTreatyRate } from "@/src/server/tax/countries";

type Row = { casilla: string; label: string; valueEur: number };

export function buildCasillasCsv(report: TaxReport): string {
  const rows: Row[] = [];
  // 0326 — Ganancias patrimoniales derivadas de la transmisión de elementos (importe total)
  rows.push({ casilla: "0326", label: "Ganancias patrimoniales (transmisión)", valueEur: report.totals.realizedGainsEur });
  // 0340 — Pérdidas computables
  rows.push({ casilla: "0340", label: "Pérdidas computables", valueEur: Math.abs(report.totals.realizedLossesComputableEur) });
  // 0343 — Saldo neto (netComputable)
  rows.push({ casilla: "0343", label: "Saldo neto ganancias/pérdidas patrimoniales", valueEur: report.totals.netComputableEur });
  // 0027 — Rendimientos del capital mobiliario (dividendos, intereses de valores)
  rows.push({ casilla: "0027", label: "Rendimientos del capital mobiliario (dividendos gross)", valueEur: report.totals.dividendsGrossEur });
  // 0029 — Retenciones e ingresos a cuenta (origen + destino)
  rows.push({
    casilla: "0029",
    label: "Retenciones e ingresos a cuenta",
    valueEur: report.totals.withholdingOrigenTotalEur + report.totals.withholdingDestinoTotalEur,
  });
  // 0588 — Deducción por doble imposición internacional (DDI) — creditable portion
  const ddi = report.dividends.reduce((sum, d) => {
    const cap = d.sourceCountry ? ddiTreatyRate(d.sourceCountry) : 0.15;
    return sum + Math.min(d.withholdingOrigenEur, cap * d.grossEur);
  }, 0);
  rows.push({ casilla: "0588", label: "Deducción doble imposición internacional", valueEur: Math.round(ddi * 100) / 100 });

  const header = "casilla|etiqueta|valor_eur";
  const body = rows.map((r) => `${r.casilla}|${r.label}|${r.valueEur}`).join("\n");
  return `\uFEFF${header}\n${body}\n`;
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Implement the route**

```ts
// src/app/api/exports/tax/casillas/route.ts
import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { buildCasillasCsv } from "@/src/lib/exports/tax-casillas";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearStr = url.searchParams.get("year");
  const year = yearStr ? Number.parseInt(yearStr, 10) : NaN;
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const csv = buildCasillasCsv(report);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="taxes-${year}-casillas.csv"`,
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/exports/ src/app/api/exports/tax/casillas/
git commit -m "feat(exports): Modelo 100 casillas CSV"
```

---

## Task 18: Detail CSV export

**Files:**
- Create: `src/lib/exports/tax-detail.ts`
- Create: `src/lib/exports/__tests__/tax-detail.test.ts`
- Create: `src/app/api/exports/tax/detail/route.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDetailCsv } from "../tax-detail";
import type { TaxReport } from "@/src/server/tax/report";

const report: TaxReport = {
  year: 2025,
  sales: [
    {
      transactionId: "tx1", tradedAt: Date.UTC(2025, 5, 1),
      accountId: "a", assetId: "x",
      quantity: 10, proceedsEur: 1500, feesEur: 0, costBasisEur: 1000,
      rawGainLossEur: 500, nonComputableLossEur: 0, computableGainLossEur: 500,
      consumedLots: [{ lotId: "l1", acquiredAt: Date.UTC(2025, 0, 1), qtyConsumed: 10, costBasisEur: 1000 }],
      assetName: "UNH", isin: "US91324P1021", assetClassTax: "listed_security",
    },
  ],
  dividends: [
    {
      transactionId: "d1", tradedAt: Date.UTC(2025, 2, 17),
      accountId: "a", assetId: "x",
      assetName: "UNH", isin: "US91324P1021",
      sourceCountry: "US",
      grossNative: 6.63, grossEur: 6.10,
      withholdingOrigenEur: 0.91, withholdingDestinoEur: 0,
      netEur: 5.19,
    },
  ],
  yearEndBalances: [],
  totals: {
    realizedGainsEur: 500, realizedLossesComputableEur: 0, nonComputableLossesEur: 0,
    netComputableEur: 500, proceedsEur: 1500, costBasisEur: 1000, feesEur: 0,
    dividendsGrossEur: 6.10, withholdingOrigenTotalEur: 0.91, withholdingDestinoTotalEur: 0,
  },
};

describe("buildDetailCsv", () => {
  it("includes sales and dividend blocks with fingerprints", () => {
    const csv = buildDetailCsv(report);
    expect(csv).toContain("# SALES");
    expect(csv).toContain("tx1");
    expect(csv).toContain("US91324P1021");
    expect(csv).toContain("# DIVIDENDS");
    expect(csv).toContain("d1");
    expect(csv).toContain("# LOTS CONSUMED");
    expect(csv).toContain("l1");
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```ts
// src/lib/exports/tax-detail.ts
import type { TaxReport } from "@/src/server/tax/report";

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      if (f == null) return "";
      const s = String(f);
      if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

export function buildDetailCsv(report: TaxReport): string {
  const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const lines: string[] = [`\uFEFF# year: ${report.year}`];

  lines.push("# SALES");
  lines.push(csvRow([
    "transactionId", "tradedAt", "assetName", "isin", "assetClassTax",
    "quantity", "proceedsEur", "costBasisEur", "feesEur",
    "rawGainLossEur", "nonComputableLossEur", "computableGainLossEur",
  ]));
  for (const s of report.sales) {
    lines.push(csvRow([
      s.transactionId, iso(s.tradedAt), s.assetName, s.isin, s.assetClassTax,
      s.quantity, s.proceedsEur, s.costBasisEur, s.feesEur,
      s.rawGainLossEur, s.nonComputableLossEur, s.computableGainLossEur,
    ]));
  }

  lines.push("# LOTS CONSUMED");
  lines.push(csvRow(["saleTransactionId", "lotId", "acquiredAt", "qtyConsumed", "costBasisEur"]));
  for (const s of report.sales) {
    for (const l of s.consumedLots) {
      lines.push(csvRow([s.transactionId, l.lotId, iso(l.acquiredAt), l.qtyConsumed, l.costBasisEur]));
    }
  }

  lines.push("# DIVIDENDS");
  lines.push(csvRow([
    "transactionId", "tradedAt", "assetName", "isin", "sourceCountry",
    "grossNative", "grossEur", "withholdingOrigenEur", "withholdingDestinoEur", "netEur",
  ]));
  for (const d of report.dividends) {
    lines.push(csvRow([
      d.transactionId, iso(d.tradedAt), d.assetName, d.isin, d.sourceCountry,
      d.grossNative, d.grossEur, d.withholdingOrigenEur, d.withholdingDestinoEur, d.netEur,
    ]));
  }

  lines.push("# YEAR-END BALANCES");
  lines.push(csvRow(["accountName", "accountCountry", "accountType", "assetName", "isin", "quantity", "valueEur"]));
  for (const b of report.yearEndBalances) {
    lines.push(csvRow([b.accountName, b.accountCountry, b.accountType, b.assetName, b.isin, b.quantity, b.valueEur]));
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Route**

```ts
// src/app/api/exports/tax/detail/route.ts
import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { buildDetailCsv } from "@/src/lib/exports/tax-detail";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const csv = buildDetailCsv(report);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="taxes-${year}-detail.csv"`,
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/exports/tax-detail.ts src/lib/exports/__tests__/tax-detail.test.ts src/app/api/exports/tax/detail/
git commit -m "feat(exports): detail CSV — sales, lots, dividends, year-end balances"
```

---

## Task 19: Modelo 720 diff export

**Files:**
- Create: `src/lib/exports/tax-m720-diff.ts`
- Create: `src/lib/exports/__tests__/tax-m720-diff.test.ts`
- Create: `src/app/api/exports/tax/m720-diff/route.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildM720DiffJson, buildM720DiffCsv } from "../tax-m720-diff";
import type { InformationalModelsStatus } from "@/src/server/tax/m720";

const models: InformationalModelsStatus = {
  m720: { blocks: [
    { country: "IE", type: "broker-securities", valueEur: 80_000, status: "delta_20k", lastDeclaredEur: 55_000 },
    { country: "NL", type: "broker-securities", valueEur: 10_000, status: "ok", lastDeclaredEur: null },
  ] },
  m721: { blocks: [
    { country: "MT", type: "crypto", valueEur: 60_000, status: "new", lastDeclaredEur: null },
  ] },
  d6: { blocks: [] },
};

describe("buildM720DiffJson / Csv", () => {
  it("JSON shape has per-model arrays", () => {
    const json = JSON.parse(buildM720DiffJson(models));
    expect(json.m720.blocks).toHaveLength(2);
    expect(json.m721.blocks).toHaveLength(1);
    expect(json.summary.needsAction).toBe(true);
  });
  it("CSV lists flagged blocks", () => {
    const csv = buildM720DiffCsv(models);
    expect(csv).toContain("m720,IE,broker-securities,delta_20k");
    expect(csv).toContain("m721,MT,crypto,new");
  });
});
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement**

```ts
// src/lib/exports/tax-m720-diff.ts
import type { InformationalModelsStatus, AnnotatedBlock } from "@/src/server/tax/m720";

function needsAction(b: AnnotatedBlock): boolean {
  return b.status !== "ok";
}

export function buildM720DiffJson(models: InformationalModelsStatus): string {
  const all = [...models.m720.blocks, ...models.m721.blocks, ...models.d6.blocks];
  const summary = {
    needsAction: all.some(needsAction),
    newBlocks: all.filter((b) => b.status === "new").length,
    delta20k: all.filter((b) => b.status === "delta_20k").length,
    fullExits: all.filter((b) => b.status === "full_exit").length,
  };
  return JSON.stringify({ summary, ...models }, null, 2);
}

export function buildM720DiffCsv(models: InformationalModelsStatus): string {
  const rows: string[] = ["\uFEFFmodel,country,type,status,value_eur,last_declared_eur"];
  for (const [model, data] of [["m720", models.m720], ["m721", models.m721], ["d6", models.d6]] as const) {
    for (const b of data.blocks) {
      rows.push(`${model},${b.country},${b.type},${b.status},${b.valueEur},${b.lastDeclaredEur ?? ""}`);
    }
  }
  return rows.join("\n") + "\n";
}
```

- [ ] **Step 4: Run — pass**

- [ ] **Step 5: Route**

```ts
// src/app/api/exports/tax/m720-diff/route.ts
import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { computeInformationalModelsStatus } from "@/src/server/tax/m720";
import { buildM720DiffCsv, buildM720DiffJson } from "@/src/lib/exports/tax-m720-diff";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  const format = url.searchParams.get("format") ?? "json";
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const models = snapshot
    ? (snapshot.payload as { m720: unknown; m721: unknown; d6: unknown }) as Parameters<typeof buildM720DiffJson>[0]
    : computeInformationalModelsStatus(db, year, aggregateBlocksFromBalances(report.yearEndBalances));
  if (format === "csv") {
    return new NextResponse(buildM720DiffCsv(models), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="taxes-${year}-m720-diff.csv"`,
      },
    });
  }
  return new NextResponse(buildM720DiffJson(models), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="taxes-${year}-m720-diff.json"`,
    },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/exports/tax-m720-diff.ts src/lib/exports/__tests__/tax-m720-diff.test.ts src/app/api/exports/tax/m720-diff/
git commit -m "feat(exports): Modelo 720/721/D-6 diff in JSON and CSV"
```

---

## Task 20: PDF report upgrade

**Files:**
- Modify: `src/lib/pdf/tax-report.ts`
- Modify (rename): `src/app/api/exports/tax-report/route.ts` → `src/app/api/exports/tax/pdf/route.ts` (new path, delete the old)

- [ ] **Step 1: Replace `src/lib/pdf/tax-report.ts`**

Rewrite to accept `TaxReport` + `InformationalModelsStatus` and produce a multi-section PDF:
- Header: "Declaración IRPF — <year>" + sealed timestamp if applicable
- Totals block (7 KPIs)
- Realised sales table with lot breakdown per sale
- Dividends table with retenciones + DDI estimate
- Year-end informational models block
- Generation note at the bottom

Use `jsPDF` as today. Keep the file under ~250 lines. Expose:

```ts
export type TaxPdfInput = {
  year: number;
  report: TaxReport;
  models: InformationalModelsStatus;
  sealedAt: number | null;
};
export function buildTaxReportPdf(input: TaxPdfInput): Uint8Array { ... }
```

(Exact code block omitted because it's long; the engineer should read the current `tax-report.ts` and rewrite it section-by-section to match the new shape. Acceptance criterion: renders without throwing, contains at least one sale, dividend, and year-end row from any non-empty report.)

Because full code is required per plan convention, here's a minimally viable implementation:

```ts
import { jsPDF } from "jspdf";
import type { TaxReport } from "@/src/server/tax/report";
import type { InformationalModelsStatus } from "@/src/server/tax/m720";

export type TaxPdfInput = {
  year: number;
  report: TaxReport;
  models: InformationalModelsStatus;
  sealedAt: number | null;
};

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

function fmt(n: number): string { return eur.format(n); }

export function buildTaxReportPdf(input: TaxPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 40;
  const L = 40;

  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(`IRPF — ${input.year}`, L, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(input.sealedAt ? `Sealed ${new Date(input.sealedAt).toISOString().slice(0, 10)}` : "Unsealed (live)", L, y); y += 18;

  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Totales", L, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const t = input.report.totals;
  const rows: [string, string][] = [
    ["Realized gains", fmt(t.realizedGainsEur)],
    ["Realized losses (computable)", fmt(t.realizedLossesComputableEur)],
    ["Non-computable losses (art. 33.5)", fmt(t.nonComputableLossesEur)],
    ["Net computable", fmt(t.netComputableEur)],
    ["Dividends gross", fmt(t.dividendsGrossEur)],
    ["Retención origen total", fmt(t.withholdingOrigenTotalEur)],
  ];
  for (const [label, val] of rows) { doc.text(label, L, y); doc.text(val, 500, y, { align: "right" }); y += 14; }
  y += 10;

  doc.setFont("helvetica", "bold"); doc.text("Ganancias patrimoniales", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const s of input.report.sales) {
    if (y > 780) { doc.addPage(); y = 40; }
    doc.text(`${new Date(s.tradedAt).toISOString().slice(0, 10)}  ${s.assetName ?? s.assetId}  qty ${s.quantity}`, L, y); y += 12;
    doc.text(`  gross ${fmt(s.rawGainLossEur)}  non-comp ${fmt(s.nonComputableLossEur)}  computable ${fmt(s.computableGainLossEur)}`, L, y); y += 14;
  }

  doc.setFont("helvetica", "bold"); doc.text("Dividendos", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const d of input.report.dividends) {
    if (y > 780) { doc.addPage(); y = 40; }
    doc.text(`${new Date(d.tradedAt).toISOString().slice(0, 10)}  ${d.assetName ?? d.assetId}  ${d.sourceCountry ?? "—"}  gross ${fmt(d.grossEur)}  WHT ${fmt(d.withholdingOrigenEur)}`, L, y); y += 12;
  }

  doc.setFont("helvetica", "bold"); doc.text("Modelos informativos", L, y); y += 14;
  doc.setFont("helvetica", "normal");
  const renderBlocks = (label: string, blocks: InformationalModelsStatus["m720"]["blocks"]) => {
    doc.text(label, L, y); y += 12;
    for (const b of blocks) { doc.text(`  ${b.country}  ${b.type}  ${b.status}  ${fmt(b.valueEur)}`, L, y); y += 12; }
  };
  renderBlocks("720", input.models.m720.blocks);
  renderBlocks("721", input.models.m721.blocks);
  renderBlocks("D-6", input.models.d6.blocks);

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
```

- [ ] **Step 2: Create new route `src/app/api/exports/tax/pdf/route.ts`**

```ts
import { NextResponse } from "next/server";
import { db } from "@/src/db/client";
import { buildTaxReport } from "@/src/server/tax/report";
import { getSnapshot } from "@/src/server/tax/seals";
import { computeInformationalModelsStatus, type InformationalModelsStatus } from "@/src/server/tax/m720";
import { aggregateBlocksFromBalances } from "@/src/server/tax/m720Aggregate";
import { buildTaxReportPdf } from "@/src/lib/pdf/tax-report";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(year)) return new NextResponse("year required", { status: 400 });
  const snapshot = getSnapshot(db, year);
  const report = snapshot?.payload.report ?? buildTaxReport(db, year);
  const models = snapshot
    ? (snapshot.payload as unknown as { m720: InformationalModelsStatus["m720"]; m721: InformationalModelsStatus["m721"]; d6: InformationalModelsStatus["d6"] })
    : computeInformationalModelsStatus(db, year, aggregateBlocksFromBalances(report.yearEndBalances));
  const pdf = buildTaxReportPdf({
    year,
    report,
    models: models as InformationalModelsStatus,
    sealedAt: snapshot?.sealedAt ?? null,
  });
  return new NextResponse(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="taxes-${year}.pdf"`,
    },
  });
}
```

- [ ] **Step 3: Delete the old route**

```bash
rm -r src/app/api/exports/tax-report
```

If `src/app/api/exports/tax-report/route.ts` is referenced elsewhere (search), update those references to point at `/api/exports/tax/pdf`.

- [ ] **Step 4: Typecheck and test**

`pnpm typecheck && pnpm test && pnpm build` — all clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/tax-report.ts src/app/api/exports/tax/pdf/ src/app/api/exports/
git commit -m "feat(exports): PDF tax report — multi-section with 720 status"
```

---

## Task 21: Drop the legacy `/src/server/taxes.ts` shim

**Files:**
- Modify or delete: `src/server/taxes.ts`
- Modify callers that import from it

- [ ] **Step 1: Find callers**

`grep -rln "server/taxes\"" src/ scripts/ 2>/dev/null`

- [ ] **Step 2: Replace imports**

For each caller:
- `getTaxYears` → import from `src/server/tax/years.ts` (create new small file: one function pulling distinct years from `assetTransactions` + `accountCashMovements`, exactly as the shim did today).
- `computeRealizedGainsForYear` / `computeDividendAndInterestForYear` → if used only by the old `/taxes` page (now a redirect), delete the legacy page's imports. If still referenced by tests, inline what's needed.

- [ ] **Step 3: Create `src/server/tax/years.ts`**

```ts
import { db as defaultDb, type DB } from "../../db/client";
import { accountCashMovements, assetTransactions } from "../../db/schema";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db.select({ tradedAt: assetTransactions.tradedAt }).from(assetTransactions).all();
  const cash = await db.select({ occurredAt: accountCashMovements.occurredAt }).from(accountCashMovements).all();
  const years = new Set<number>();
  for (const r of rows) years.add(new Date(r.tradedAt).getUTCFullYear());
  for (const r of cash) years.add(new Date(r.occurredAt).getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}
```

- [ ] **Step 4: Update `/taxes` redirect to use the new import**

In `src/app/taxes/page.tsx`:
```ts
import { getTaxYears } from "@/src/server/tax/years";
```

- [ ] **Step 5: Delete `src/server/taxes.ts`**

`rm src/server/taxes.ts`

- [ ] **Step 6: Update or delete `src/server/taxes.test.ts`**

The test exercises the legacy shim. If the behaviour is now covered by `src/server/tax/__tests__/report.test.ts`, delete the legacy test. Otherwise port the cases that add value to the new test file and delete the old.

- [ ] **Step 7: Run all tests + build**

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all clean.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "refactor(tax): drop legacy taxes.ts shim; getTaxYears lives in tax/years.ts"
```

---

## Task 22: Final verification

- [ ] **Step 1: Run full suite**

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` — clean (the 2 pre-existing degiro/cobas snapshot failures remain allowable).

- [ ] **Step 2: Fresh-DB smoke**

Against a fresh DB:
1. `rm -rf data/*.db && pnpm db:migrate`
2. `pnpm dev`
3. Create a DEGIRO account (country NL, type broker), import `statement.csv`.
4. Visit `/taxes/2025`:
   - KPI row renders 7 cards.
   - Gains table empty (no sells in the fixture).
   - Dividends table: 2 UNH rows, country "US", withholdingOrigen ~€0.91 each, DDI cap populated.
   - Year-end card shows a NL broker-securities block.
5. Seal 2025 via button. Refresh. Unseal button appears. Export dropdown downloads each file.
6. Delete a trade → drift banner appears.
7. Unseal and reseal — drift gone.

- [ ] **Step 3: Definition of Done check**

- `pnpm typecheck` ✅
- `pnpm lint` ✅ (0 errors, 0 warnings)
- `pnpm test` ✅
- `pnpm build` ✅
- Every new monetary render wrapped in `<SensitiveValue>` (spot-check GainsTable, DividendsTable, YearEndCard, DriftBanner, TaxKpiRow)
- Dark + light mode verified for `/taxes/[year]`
- Every mutation writes an audit event + revalidatePath (sealYear, unsealYear, createSwap, createDividend)

- [ ] **Step 4: Commit final (if any doc-only adjustments)**

Otherwise this is the handoff point to merge.

---

## Self-review summary

Spec coverage (against `docs/superpowers/specs/2026-04-19-spanish-tax-reporting-design.md`):

- §3.3 `buildTaxReport` extended with year-end balances → Task 1 ✓
- §3.4 sealYear / unsealYear / getSnapshot / computeDriftSinceSeal → Tasks 4, 5 ✓
- §3.5 m720/721/D-6 status engine → Tasks 2, 3 ✓
- §4.1 `/taxes/[year]` dynamic route + header + KPIs + tables + drift + seal → Tasks 6–12 ✓
- §4.2 createSwap modal → Tasks 13, 15 ✓
- §4.3 Dividend form → Tasks 14, 15 ✓
- §4.5 Broker/crypto account pages: cash KPI removed (done in Plan 1)
- §7 Exports: PDF, casillas CSV, detail CSV, m720 diff → Tasks 17–20 ✓
- §8 Tests: all new units have dedicated tests (Tasks 2, 3, 4, 5, 13, 14, 17, 18, 19) ✓
- §11 Acceptance: fresh-DB smoke covers the flow → Task 22 ✓
- Bonus: FX column on `/transactions` → Task 16 ✓

Out of scope (deferred): iShares ETF classification refinement (Plan 1 review minor #5), deeper recursive wash-sale chain (Plan 1 review note #8), `/transactions` overall visual rework, detail export of wash-sale adjustments as a separate block (folded into detail CSV's SALES block via `nonComputableLossEur` column).
