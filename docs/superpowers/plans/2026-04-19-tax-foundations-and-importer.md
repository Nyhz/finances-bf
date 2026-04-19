# Tax Foundations + DEGIRO Importer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the schema, tax engine, and DEGIRO Account Statement importer described in §2–§3, §5, §6, §9 of the [spec](../specs/2026-04-19-spanish-tax-reporting-design.md). No user-visible UI changes. End state: wiping the DEGIRO account, re-importing `statement.csv`, and running `buildTaxReport(year)` produces correct FIFO + dividend + wash-sale numbers with persisted lot traceability.

**Architecture:** Additive schema migration → new `src/server/tax/` engine with persisted lots → hook recompute into existing mutations → backfill lots for existing data → new `degiro-statement` parser → destructive `reimportAccount` action. Every mutation runs inside a DB transaction. Every asset-level write triggers `recomputeLotsForAsset`. Wash-sale is part of the lot walk, not a post-pass.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM over better-sqlite3, Zod, Vitest, ULID. No new deps.

---

## File Structure

**New files:**
- `src/db/schema/tax_lots.ts`
- `src/db/schema/tax_lot_consumptions.ts`
- `src/db/schema/tax_wash_sale_adjustments.ts`
- `src/db/schema/tax_year_snapshots.ts`
- `drizzle/0004_tax_foundations.sql` (generated)
- `src/server/tax/lots.ts`
- `src/server/tax/washSale.ts`
- `src/server/tax/report.ts`
- `src/server/tax/countries.ts` (ISIN→country + DDI treaty rates)
- `src/server/tax/classification.ts` (asset_class_tax inference)
- `src/server/tax/__tests__/lots.test.ts`
- `src/server/tax/__tests__/washSale.test.ts`
- `src/server/tax/__tests__/report.test.ts`
- `src/lib/imports/degiro-statement.ts`
- `src/lib/imports/__tests__/degiro-statement.test.ts`
- `src/lib/imports/__fixtures__/degiro-statement.sample.csv` (copied from `docs/superpowers/specs/2026-04-19-statement-sample.csv`)
- `src/actions/reimportAccount.ts`
- `src/actions/reimportAccount.schema.ts`
- `src/actions/__tests__/reimportAccount.test.ts`
- `scripts/backfill-tax-lots.ts`
- `scripts/backfill-asset-class.ts`

**Modified files:**
- `src/db/schema/asset_transactions.ts` — add `sourceCountry`, `isListed`, `withholdingTaxDestination`
- `src/db/schema/accounts.ts` — add `countryCode`
- `src/db/schema/assets.ts` — add `assetClassTax`
- `src/db/schema/index.ts` — export new schema files
- `src/actions/createTransaction.ts` — call `recomputeLotsForAsset`, skip cash movement for broker/crypto/wallet accounts
- `src/actions/confirmImport.ts` — same hooks
- `src/actions/deleteTransaction.ts` — same hooks
- `src/lib/imports/types.ts` — new `source: "degiro-statement"` literal, new `DividendParsedRow` shape
- `src/server/taxes.ts` — becomes a re-export shim that delegates to `src/server/tax/report.ts` so existing `/taxes` page keeps compiling
- `src/server/recompute.ts` — `recomputeAccountCashBalance` becomes a no-op for broker/crypto/wallet accounts

---

## Conventions used throughout

- **Commit after every passing test.** One feature per commit, Conventional Commits prefix.
- **Types over interfaces** for data shapes, per CLAUDE.md.
- **EUR rounding helper:** reuse `round(n)` pattern from `createTransaction.ts` (`Math.round(n * 100) / 100`) — import it from a new `src/lib/money.ts` in Task 5 (first time we need it outside actions).
- **Migration generation:** never hand-write SQL — run `pnpm db:generate` after editing a schema file and commit the produced file. If the generator produces extra noise, keep it.
- **Test pattern:** tests that touch the DB use `new Database(":memory:")` + `drizzle()` + `migrate()` helpers from `src/db/__tests__/_helpers.ts` (already exists — read it before writing tests).

---

## Task 1: Migration — add columns to existing tables

**Files:**
- Modify: `src/db/schema/asset_transactions.ts`
- Modify: `src/db/schema/accounts.ts`
- Modify: `src/db/schema/assets.ts`
- Create: `drizzle/0004_tax_columns.sql` (via generator)

- [ ] **Step 1: Edit `src/db/schema/asset_transactions.ts`**

Add three columns inside the `sqliteTable` column object, right after `withholdingTax`:

```ts
sourceCountry: text("source_country"),
isListed: integer("is_listed", { mode: "boolean" }).notNull().default(true),
withholdingTaxDestination: real("withholding_tax_destination"),
```

- [ ] **Step 2: Edit `src/db/schema/accounts.ts`**

Add after `accountType`:

```ts
countryCode: text("country_code"),
```

- [ ] **Step 3: Edit `src/db/schema/assets.ts`**

Add after `currency`:

```ts
assetClassTax: text("asset_class_tax"),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: new file `drizzle/0004_*.sql` with `ALTER TABLE` statements for the three columns. Rename the file to `drizzle/0004_tax_columns.sql` (keep whatever suffix the generator produced — only change the number if the generator used a different one).

- [ ] **Step 5: Apply and verify**

Run: `pnpm db:migrate`
Expected: exits 0. Then `pnpm typecheck` — expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/ drizzle/
git commit -m "feat(db): add source_country, is_listed, withholding_destination, country_code, asset_class_tax columns"
```

---

## Task 2: Migration — new tax tables

**Files:**
- Create: `src/db/schema/tax_lots.ts`
- Create: `src/db/schema/tax_lot_consumptions.ts`
- Create: `src/db/schema/tax_wash_sale_adjustments.ts`
- Create: `src/db/schema/tax_year_snapshots.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0005_tax_tables.sql` (via generator)

- [ ] **Step 1: Create `src/db/schema/tax_lots.ts`**

```ts
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts";
import { assets } from "./assets";
import { assetTransactions } from "./asset_transactions";
import { createdAtCol, idCol } from "./_shared";

export const taxLots = sqliteTable(
  "tax_lots",
  {
    id: idCol(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    originTransactionId: text("origin_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    acquiredAt: integer("acquired_at", { mode: "number" }).notNull(),
    originalQty: real("original_qty").notNull(),
    remainingQty: real("remaining_qty").notNull(),
    unitCostEur: real("unit_cost_eur").notNull(),
    deferredLossAddedEur: real("deferred_loss_added_eur").notNull().default(0),
    createdAt: createdAtCol(),
  },
  (t) => ({
    assetAcquiredIdx: index("tax_lots_asset_acquired_idx").on(t.assetId, t.acquiredAt),
    originIdx: uniqueIndex("tax_lots_origin_idx").on(t.originTransactionId),
  }),
);

export type TaxLot = typeof taxLots.$inferSelect;
export type NewTaxLot = typeof taxLots.$inferInsert;
```

- [ ] **Step 2: Create `src/db/schema/tax_lot_consumptions.ts`**

```ts
import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { assetTransactions } from "./asset_transactions";
import { taxLots } from "./tax_lots";
import { createdAtCol, idCol } from "./_shared";

export const taxLotConsumptions = sqliteTable(
  "tax_lot_consumptions",
  {
    id: idCol(),
    saleTransactionId: text("sale_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    lotId: text("lot_id")
      .notNull()
      .references(() => taxLots.id, { onDelete: "cascade" }),
    qtyConsumed: real("qty_consumed").notNull(),
    costBasisEur: real("cost_basis_eur").notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    saleIdx: index("tax_lot_consumptions_sale_idx").on(t.saleTransactionId),
    uniquePair: uniqueIndex("tax_lot_consumptions_unique_pair").on(
      t.saleTransactionId,
      t.lotId,
    ),
  }),
);

export type TaxLotConsumption = typeof taxLotConsumptions.$inferSelect;
export type NewTaxLotConsumption = typeof taxLotConsumptions.$inferInsert;
```

- [ ] **Step 3: Create `src/db/schema/tax_wash_sale_adjustments.ts`**

```ts
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { assetTransactions } from "./asset_transactions";
import { taxLots } from "./tax_lots";
import { createdAtCol, idCol } from "./_shared";

export const taxWashSaleAdjustments = sqliteTable(
  "tax_wash_sale_adjustments",
  {
    id: idCol(),
    saleTransactionId: text("sale_transaction_id")
      .notNull()
      .references(() => assetTransactions.id, { onDelete: "cascade" }),
    absorbingLotId: text("absorbing_lot_id")
      .notNull()
      .references(() => taxLots.id, { onDelete: "cascade" }),
    disallowedLossEur: real("disallowed_loss_eur").notNull(),
    windowDays: integer("window_days", { mode: "number" }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    saleIdx: index("tax_wash_sale_adjustments_sale_idx").on(t.saleTransactionId),
  }),
);

export type TaxWashSaleAdjustment = typeof taxWashSaleAdjustments.$inferSelect;
export type NewTaxWashSaleAdjustment = typeof taxWashSaleAdjustments.$inferInsert;
```

- [ ] **Step 4: Create `src/db/schema/tax_year_snapshots.ts`**

```ts
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { idCol } from "./_shared";

export const taxYearSnapshots = sqliteTable(
  "tax_year_snapshots",
  {
    id: idCol(),
    year: integer("year", { mode: "number" }).notNull(),
    sealedAt: integer("sealed_at", { mode: "number" }).notNull(),
    payloadJson: text("payload_json").notNull(),
    renderedPdfPath: text("rendered_pdf_path"),
    renderedCsvPaths: text("rendered_csv_paths"),
    notes: text("notes"),
  },
  (t) => ({
    yearIdx: uniqueIndex("tax_year_snapshots_year_idx").on(t.year),
  }),
);

export type TaxYearSnapshot = typeof taxYearSnapshots.$inferSelect;
export type NewTaxYearSnapshot = typeof taxYearSnapshots.$inferInsert;
```

- [ ] **Step 5: Add exports to `src/db/schema/index.ts`**

Append:

```ts
export * from "./tax_lots";
export * from "./tax_lot_consumptions";
export * from "./tax_wash_sale_adjustments";
export * from "./tax_year_snapshots";
```

- [ ] **Step 6: Generate migration**

Run: `pnpm db:generate`
Expected: new `drizzle/0005_*.sql` with the four `CREATE TABLE` + indexes. Rename to `0005_tax_tables.sql` if needed.

- [ ] **Step 7: Apply and typecheck**

Run: `pnpm db:migrate && pnpm typecheck`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/ drizzle/
git commit -m "feat(db): add tax_lots, tax_lot_consumptions, tax_wash_sale_adjustments, tax_year_snapshots tables"
```

---

## Task 3: Country + DDI rate helpers

**Files:**
- Create: `src/server/tax/countries.ts`
- Create: `src/server/tax/__tests__/countries.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/server/tax/__tests__/countries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countryFromIsin, ddiTreatyRate } from "../countries";

describe("countryFromIsin", () => {
  it("returns the country code from a US ISIN prefix", () => {
    expect(countryFromIsin("US91324P1021")).toBe("US");
  });
  it("returns the country code from an IE ISIN prefix", () => {
    expect(countryFromIsin("IE00B5L8K969")).toBe("IE");
  });
  it("returns the country code from an ES ISIN prefix", () => {
    expect(countryFromIsin("ES0126962069")).toBe("ES");
  });
  it("returns null for a malformed ISIN", () => {
    expect(countryFromIsin("12ABCDEF1234")).toBeNull();
    expect(countryFromIsin("")).toBeNull();
  });
});

describe("ddiTreatyRate", () => {
  it("returns 0.15 for US (Spain treaty cap)", () => {
    expect(ddiTreatyRate("US")).toBe(0.15);
  });
  it("returns 0 for Spain (no DDI on domestic dividends)", () => {
    expect(ddiTreatyRate("ES")).toBe(0);
  });
  it("returns 0.15 as default for unknown countries", () => {
    expect(ddiTreatyRate("ZZ")).toBe(0.15);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test countries.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/tax/countries.ts`**

```ts
// Minimum country set relevant to a Spanish retail investor. Extend as needed.
const KNOWN_COUNTRIES = new Set([
  "US", "IE", "ES", "DE", "FR", "NL", "LU", "GB", "CH", "JP",
  "CA", "AU", "BE", "AT", "IT", "PT", "FI", "SE", "DK", "NO",
]);

export function countryFromIsin(isin: string): string | null {
  if (!isin || isin.length < 2) return null;
  const prefix = isin.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(prefix)) return null;
  return KNOWN_COUNTRIES.has(prefix) ? prefix : prefix;
}

// Cap of foreign withholding that Spain recognises for DDI (deducción por
// doble imposición internacional), by source country. Falls back to 15%
// which is the most common bilateral treaty rate.
const DDI_RATES: Record<string, number> = {
  US: 0.15,
  ES: 0, // domestic — DDI does not apply
  IE: 0, // usually 0% WHT on Irish-domiciled UCITS ETFs
  LU: 0.15,
  GB: 0,
  DE: 0.15,
  FR: 0.15,
  NL: 0.15,
  CH: 0.15,
};

export function ddiTreatyRate(country: string): number {
  if (country === "ES") return 0;
  return DDI_RATES[country] ?? 0.15;
}
```

- [ ] **Step 4: Run and verify**

Run: `pnpm test countries.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/
git commit -m "feat(tax): ISIN→country helper and DDI treaty rate table"
```

---

## Task 4: Asset classification helper

**Files:**
- Create: `src/server/tax/classification.ts`
- Create: `src/server/tax/__tests__/classification.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { inferAssetClassTax } from "../classification";

describe("inferAssetClassTax", () => {
  it("classifies ETFs by ticker hint", () => {
    expect(inferAssetClassTax({ assetType: "equity", ticker: "VWCE", isin: "IE00BK5BQT80" })).toBe("etf");
  });
  it("classifies Irish-domiciled funds as etf when name contains UCITS", () => {
    expect(inferAssetClassTax({ assetType: "equity", name: "iShares MSCI Whatever UCITS ETF", isin: "IE00B5L8K969" })).toBe("etf");
  });
  it("classifies crypto assets", () => {
    expect(inferAssetClassTax({ assetType: "crypto" })).toBe("crypto");
  });
  it("defaults ES-listed equities to listed_security", () => {
    expect(inferAssetClassTax({ assetType: "equity", isin: "ES0126962069" })).toBe("listed_security");
  });
  it("defaults US equities to listed_security", () => {
    expect(inferAssetClassTax({ assetType: "equity", isin: "US91324P1021" })).toBe("listed_security");
  });
  it("returns other when nothing matches", () => {
    expect(inferAssetClassTax({ assetType: "unknown" })).toBe("other");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test classification.test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/server/tax/classification.ts`**

```ts
export type AssetClassTax =
  | "listed_security"
  | "unlisted_security"
  | "fund"
  | "etf"
  | "crypto"
  | "bond"
  | "other";

export type ClassificationInput = {
  assetType?: string | null;
  subtype?: string | null;
  name?: string | null;
  ticker?: string | null;
  isin?: string | null;
};

export function inferAssetClassTax(input: ClassificationInput): AssetClassTax {
  const type = (input.assetType ?? "").toLowerCase();
  const name = (input.name ?? "").toLowerCase();
  const subtype = (input.subtype ?? "").toLowerCase();

  if (type === "crypto" || subtype === "crypto") return "crypto";
  if (type === "bond" || subtype === "bond") return "bond";

  const looksLikeEtf =
    subtype === "etf" ||
    /\betf\b/.test(name) ||
    /ucits/.test(name) ||
    /\b(acc|accumulating|dist|distributing)\b/.test(name);
  if (looksLikeEtf) return "etf";

  if (type === "fund") return "fund";
  if (type === "equity" || type === "stock" || type === "share") return "listed_security";

  return "other";
}
```

- [ ] **Step 4: Run and verify**

Run: `pnpm test classification.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tax/
git commit -m "feat(tax): asset_class_tax inference"
```

---

## Task 5: Money helper extraction

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/__tests__/money.test.ts`
- Modify: `src/actions/createTransaction.ts` (replace local `round`)

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { roundEur } from "../money";

describe("roundEur", () => {
  it("rounds to 2dp half-away-from-zero", () => {
    expect(roundEur(1.005)).toBe(1.01);
    expect(roundEur(1.004)).toBe(1.0);
    expect(roundEur(-1.005)).toBe(-1.0); // JS Math.round rounds half toward +inf
  });
  it("handles integer inputs", () => {
    expect(roundEur(42)).toBe(42);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test money.test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/money.ts`**

```ts
// 2-decimal EUR rounding. Matches the inline `round` helper that has been
// used across actions since inception. Note: uses Math.round, which rounds
// half toward +Infinity — keep this behaviour for consistency with existing
// stored values.
export function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: Run and verify**

Run: `pnpm test money.test`
Expected: PASS.

- [ ] **Step 5: Replace `round` in `createTransaction.ts`**

In `src/actions/createTransaction.ts`, delete the local `round` function at the bottom and add `import { roundEur as round } from "../lib/money";` near the other imports.

- [ ] **Step 6: Typecheck + existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/money.ts src/lib/__tests__/money.test.ts src/actions/createTransaction.ts
git commit -m "refactor(money): extract roundEur helper"
```

---

## Task 6: `recomputeLotsForAsset` — buy/sell FIFO

**Files:**
- Create: `src/server/tax/lots.ts`
- Create: `src/server/tax/__tests__/lots.test.ts`

- [ ] **Step 1: Read the test DB helper**

Read `src/db/__tests__/_helpers.ts` (or search for `memory` / `migrate` test setup in `src/**/*.test.ts`) to confirm the in-memory DB pattern used by this project. Follow it exactly.

- [ ] **Step 2: Write failing test for single buy → single sell**

Create `src/server/tax/__tests__/lots.test.ts` with:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { createTestDb } from "@/src/db/__tests__/_helpers"; // adapt import to what exists
import {
  accounts,
  assets,
  assetTransactions,
  taxLots,
  taxLotConsumptions,
} from "@/src/db/schema";
import { recomputeLotsForAsset } from "../lots";

async function seedAccountAndAsset(db: ReturnType<typeof createTestDb>) {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: assetId, name: "VWCE", assetType: "equity", isin: "IE00BK5BQT80", currency: "EUR", isActive: true, assetClassTax: "etf" }).run();
  return { accountId, assetId };
}

function insertTrade(db: any, accountId: string, assetId: string, opts: {
  type: "buy" | "sell"; qty: number; unitPriceEur: number; feesEur: number; tradedAt: number;
}) {
  const id = ulid();
  const gross = opts.qty * opts.unitPriceEur;
  db.insert(assetTransactions).values({
    id,
    accountId,
    assetId,
    transactionType: opts.type,
    tradedAt: opts.tradedAt,
    quantity: opts.qty,
    unitPrice: opts.unitPriceEur,
    tradeCurrency: "EUR",
    fxRateToEur: 1,
    tradeGrossAmount: gross,
    tradeGrossAmountEur: gross,
    cashImpactEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    feesAmount: opts.feesEur,
    feesAmountEur: opts.feesEur,
    netAmountEur: opts.type === "buy" ? -(gross + opts.feesEur) : gross - opts.feesEur,
    isListed: true,
    source: "manual",
  }).run();
  return id;
}

describe("recomputeLotsForAsset", () => {
  it("creates a lot for each buy and consumes lots FIFO on sell", () => {
    const db = createTestDb();
    const { accountId, assetId } = seedAccountAndAsset(db);

    const buy1 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 100, feesEur: 2, tradedAt: Date.UTC(2025, 0, 1) });
    const buy2 = insertTrade(db, accountId, assetId, { type: "buy", qty: 10, unitPriceEur: 120, feesEur: 2, tradedAt: Date.UTC(2025, 1, 1) });
    const sell = insertTrade(db, accountId, assetId, { type: "sell", qty: 15, unitPriceEur: 130, feesEur: 3, tradedAt: Date.UTC(2025, 6, 1) });

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));

    const lots = db.select().from(taxLots).where(eq(taxLots.assetId, assetId)).all();
    expect(lots).toHaveLength(2);
    const firstLot = lots.find((l) => l.originTransactionId === buy1)!;
    const secondLot = lots.find((l) => l.originTransactionId === buy2)!;
    expect(firstLot.remainingQty).toBe(0); // fully consumed
    expect(secondLot.remainingQty).toBe(5); // 10 - 5 consumed

    const consumptions = db.select().from(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, sell)).all();
    expect(consumptions).toHaveLength(2);
    const c1 = consumptions.find((c) => c.lotId === firstLot.id)!;
    const c2 = consumptions.find((c) => c.lotId === secondLot.id)!;
    expect(c1.qtyConsumed).toBe(10);
    expect(c2.qtyConsumed).toBe(5);

    // unit cost of buy1 = (1000 + 2) / 10 = 100.2 → consumed cost 1002
    // unit cost of buy2 = (1200 + 2) / 10 = 120.2 → 5 * 120.2 = 601
    expect(c1.costBasisEur).toBeCloseTo(1002, 4);
    expect(c2.costBasisEur).toBeCloseTo(601, 4);
  });

  it("is idempotent", () => {
    const db = createTestDb();
    const { accountId, assetId } = seedAccountAndAsset(db);
    insertTrade(db, accountId, assetId, { type: "buy", qty: 5, unitPriceEur: 10, feesEur: 0, tradedAt: Date.UTC(2025, 0, 1) });

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));
    const first = db.select().from(taxLots).all();
    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));
    const second = db.select().from(taxLots).all();
    expect(second).toHaveLength(first.length);
    expect(second[0].remainingQty).toBe(first[0].remainingQty);
  });

  it("ignores dividend transactions", () => {
    const db = createTestDb();
    const { accountId, assetId } = seedAccountAndAsset(db);
    db.insert(assetTransactions).values({
      id: ulid(),
      accountId, assetId,
      transactionType: "dividend",
      tradedAt: Date.UTC(2025, 5, 1),
      quantity: 0, unitPrice: 0,
      tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.1,
      cashImpactEur: 5.2, feesAmount: 0, feesAmountEur: 0,
      netAmountEur: 5.2,
      isListed: true,
      source: "manual",
    }).run();

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));
    expect(db.select().from(taxLots).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `pnpm test lots.test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/server/tax/lots.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../../db/client";
import {
  assetTransactions,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";

type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

type MutableLot = {
  id: string;
  remainingQty: number;
  unitCostEur: number;
  deferredLossAddedEur: number;
  acquiredAt: number;
  originTransactionId: string;
  accountId: string;
};

export function recomputeLotsForAsset(tx: Tx, assetId: string): void {
  // 1. Wipe previous derivations for this asset.
  const txnRows = tx
    .select({ id: assetTransactions.id })
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .all();
  const txnIds = txnRows.map((r) => r.id);
  if (txnIds.length > 0) {
    // Delete dependents first (sqlite cascade is configured, but be explicit).
    for (const id of txnIds) {
      tx.delete(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, id)).run();
      tx.delete(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, id)).run();
    }
  }
  tx.delete(taxLots).where(eq(taxLots.assetId, assetId)).run();

  // 2. Replay in order.
  const rows = tx
    .select()
    .from(assetTransactions)
    .where(eq(assetTransactions.assetId, assetId))
    .orderBy(asc(assetTransactions.tradedAt), asc(assetTransactions.id))
    .all();

  const open: MutableLot[] = [];

  for (const row of rows) {
    if (row.transactionType === "buy") {
      if (row.quantity <= 0) continue;
      const unitCostEur = (row.tradeGrossAmountEur + row.feesAmountEur) / row.quantity;
      const lotId = ulid();
      tx.insert(taxLots).values({
        id: lotId,
        assetId,
        accountId: row.accountId,
        originTransactionId: row.id,
        acquiredAt: row.tradedAt,
        originalQty: row.quantity,
        remainingQty: row.quantity,
        unitCostEur,
        deferredLossAddedEur: 0,
      }).run();
      open.push({
        id: lotId,
        remainingQty: row.quantity,
        unitCostEur,
        deferredLossAddedEur: 0,
        acquiredAt: row.tradedAt,
        originTransactionId: row.id,
        accountId: row.accountId,
      });
      continue;
    }

    if (row.transactionType !== "sell") continue;

    let remaining = row.quantity;
    let consumedCostEur = 0;
    const consumptions: { lotId: string; qty: number; cost: number }[] = [];

    while (remaining > 1e-12 && open.length > 0) {
      const lot = open[0];
      const take = Math.min(lot.remainingQty, remaining);
      const unitCostWithDeferred =
        lot.unitCostEur + (lot.deferredLossAddedEur / lot.remainingQty);
      const cost = take * unitCostWithDeferred;
      consumedCostEur += cost;
      consumptions.push({ lotId: lot.id, qty: take, cost });
      lot.remainingQty -= take;
      // Consume a proportional slice of the deferred-loss credit too.
      lot.deferredLossAddedEur -=
        lot.deferredLossAddedEur * (take / (take + lot.remainingQty || take));
      remaining -= take;
      if (lot.remainingQty <= 1e-12) open.shift();
    }

    // Persist consumptions and updated lot balances.
    for (const c of consumptions) {
      tx.insert(taxLotConsumptions).values({
        id: ulid(),
        saleTransactionId: row.id,
        lotId: c.lotId,
        qtyConsumed: c.qty,
        costBasisEur: c.cost,
      }).run();
    }
    // Write back remainingQty for any lot touched that still exists.
    for (const c of consumptions) {
      const lot = open.find((l) => l.id === c.lotId);
      if (lot) {
        tx.update(taxLots).set({
          remainingQty: lot.remainingQty,
          deferredLossAddedEur: lot.deferredLossAddedEur,
        }).where(eq(taxLots.id, lot.id)).run();
      } else {
        // Fully consumed → mark remaining = 0 in DB.
        tx.update(taxLots).set({ remainingQty: 0 }).where(eq(taxLots.id, c.lotId)).run();
      }
    }

    // Wash-sale detection — Task 7 will wire this in.
  }
}
```

- [ ] **Step 5: Run tests and verify**

Run: `pnpm test lots.test`
Expected: PASS all three cases.

- [ ] **Step 6: Commit**

```bash
git add src/server/tax/lots.ts src/server/tax/__tests__/lots.test.ts
git commit -m "feat(tax): recomputeLotsForAsset with persisted FIFO"
```

---

## Task 7: Wash-sale detection

**Files:**
- Create: `src/server/tax/washSale.ts`
- Create: `src/server/tax/__tests__/washSale.test.ts`
- Modify: `src/server/tax/lots.ts` (wire in)

- [ ] **Step 1: Write failing test**

Create `src/server/tax/__tests__/washSale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { createTestDb } from "@/src/db/__tests__/_helpers";
import {
  accounts,
  assets,
  assetTransactions,
  taxLots,
  taxWashSaleAdjustments,
} from "@/src/db/schema";
import { recomputeLotsForAsset } from "../lots";

const DAY = 86_400_000;

function seed(db: ReturnType<typeof createTestDb>, assetClass: "listed_security" | "unlisted_security") {
  const accountId = ulid();
  const assetId = ulid();
  db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();
  db.insert(assets).values({ id: assetId, name: "Test Equity", assetType: "equity", currency: "EUR", isActive: true, assetClassTax: assetClass }).run();
  return { accountId, assetId };
}

function trade(db: any, accountId: string, assetId: string, type: "buy" | "sell", qty: number, price: number, tradedAt: number) {
  const gross = qty * price;
  const id = ulid();
  db.insert(assetTransactions).values({
    id, accountId, assetId,
    transactionType: type,
    tradedAt, quantity: qty, unitPrice: price,
    tradeCurrency: "EUR", fxRateToEur: 1,
    tradeGrossAmount: gross, tradeGrossAmountEur: gross,
    cashImpactEur: type === "buy" ? -gross : gross,
    feesAmount: 0, feesAmountEur: 0,
    netAmountEur: type === "buy" ? -gross : gross,
    isListed: true,
    source: "manual",
  }).run();
  return id;
}

describe("wash-sale rule", () => {
  it("flags a loss as disallowed when repurchase happens within 60 days (listed)", () => {
    const db = createTestDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);            // buy 10 @ 100
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY); // sell 10 @ 80 → loss 200
    trade(db, accountId, assetId, "buy",  10, 85,  t0 + 45 * DAY); // rebuy within 60d → triggers 33.5.f

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].disallowedLossEur).toBeCloseTo(200, 4);
    expect(adj[0].windowDays).toBe(60);

    // Absorbing lot's deferred_loss_added_eur should be bumped.
    const absorbing = db.select().from(taxLots).where(eq(taxLots.id, adj[0].absorbingLotId)).get();
    expect(absorbing!.deferredLossAddedEur).toBeCloseTo(200, 4);
  });

  it("uses 365-day window for unlisted securities", () => {
    const db = createTestDb();
    const { accountId, assetId } = seed(db, "unlisted_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  5, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 5, 80, t0 + 200 * DAY); // loss 100
    trade(db, accountId, assetId, "buy",  5, 85,  t0 + 210 * DAY); // rebuy 10 days later

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    expect(adj[0].windowDays).toBe(365);
  });

  it("does not flag a sale that ends at a gain", () => {
    const db = createTestDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 110, t0 + 30 * DAY); // gain
    trade(db, accountId, assetId, "buy",  10, 105, t0 + 45 * DAY);

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(0);
  });

  it("partial absorption when repurchased qty < sold qty", () => {
    const db = createTestDb();
    const { accountId, assetId } = seed(db, "listed_security");
    const t0 = Date.UTC(2025, 0, 1);
    trade(db, accountId, assetId, "buy",  10, 100, t0);
    const sell = trade(db, accountId, assetId, "sell", 10, 80, t0 + 30 * DAY); // loss 200
    trade(db, accountId, assetId, "buy",  3,  85,  t0 + 45 * DAY); // only 3 rebought

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));

    const adj = db.select().from(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, sell)).all();
    expect(adj).toHaveLength(1);
    // disallowed = 200 * (3/10) = 60
    expect(adj[0].disallowedLossEur).toBeCloseTo(60, 4);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test washSale.test`
Expected: FAIL — the sale is at a loss but no adjustment row exists because `recomputeLotsForAsset` doesn't call wash-sale yet.

- [ ] **Step 3: Implement `src/server/tax/washSale.ts`**

```ts
import { and, eq, gte, lte } from "drizzle-orm";
import { ulid } from "ulid";
import type { DB } from "../../db/client";
import {
  assetTransactions,
  assets,
  taxLots,
  taxWashSaleAdjustments,
  type AssetTransaction,
  type TaxLot,
} from "../../db/schema";

type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
const DAY = 86_400_000;

export function checkSaleAtLoss(
  tx: Tx,
  saleRow: AssetTransaction,
  proceedsEur: number,
  consumedCostEur: number,
  feesEur: number,
): void {
  const loss = proceedsEur - consumedCostEur - feesEur;
  if (loss >= 0) return; // gain or breakeven — nothing to do

  const asset = tx.select().from(assets).where(eq(assets.id, saleRow.assetId)).get();
  const windowDays = asset?.assetClassTax === "unlisted_security" ? 365 : 60;
  const windowMs = windowDays * DAY;

  // Find acquisitions of the same asset within ±window days of sale.
  const acquisitions = tx
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.assetId, saleRow.assetId),
        eq(assetTransactions.transactionType, "buy"),
        gte(assetTransactions.tradedAt, saleRow.tradedAt - windowMs),
        lte(assetTransactions.tradedAt, saleRow.tradedAt + windowMs),
      ),
    )
    .all();

  if (acquisitions.length === 0) return;

  const soldQty = saleRow.quantity;
  const acquiredQty = acquisitions.reduce((sum, a) => sum + a.quantity, 0);
  const absorbingQty = Math.min(soldQty, acquiredQty);
  if (absorbingQty <= 0) return;

  const totalDisallowed = Math.abs(loss) * (absorbingQty / soldQty);

  // Distribute disallowed loss across absorbing lots by their originalQty share.
  for (const acq of acquisitions) {
    const lot = tx
      .select()
      .from(taxLots)
      .where(eq(taxLots.originTransactionId, acq.id))
      .get();
    if (!lot) continue;
    const share = (acq.quantity / acquiredQty) * totalDisallowed;
    if (share <= 1e-9) continue;

    tx.insert(taxWashSaleAdjustments).values({
      id: ulid(),
      saleTransactionId: saleRow.id,
      absorbingLotId: lot.id,
      disallowedLossEur: share,
      windowDays,
    }).run();

    tx.update(taxLots)
      .set({ deferredLossAddedEur: lot.deferredLossAddedEur + share })
      .where(eq(taxLots.id, lot.id))
      .run();
  }
}
```

- [ ] **Step 4: Wire into `recomputeLotsForAsset`**

Edit `src/server/tax/lots.ts`: at the top, add `import { checkSaleAtLoss } from "./washSale";`. Replace the `// Wash-sale detection — Task 7 will wire this in.` placeholder with:

```ts
checkSaleAtLoss(
  tx,
  row,
  row.tradeGrossAmountEur,
  consumedCostEur,
  row.feesAmountEur,
);
```

- [ ] **Step 5: Run wash-sale tests**

Run: `pnpm test washSale.test`
Expected: PASS all four cases.

- [ ] **Step 6: Re-run all tax tests**

Run: `pnpm test src/server/tax`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/tax/
git commit -m "feat(tax): regla de los 2 meses / 1 año wash-sale detection"
```

---

## Task 8: `buildTaxReport` from persisted lots

**Files:**
- Create: `src/server/tax/report.ts`
- Create: `src/server/tax/__tests__/report.test.ts`
- Modify: `src/server/taxes.ts` (delegate)

- [ ] **Step 1: Write failing test — end-to-end scenario**

Create `src/server/tax/__tests__/report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { createTestDb } from "@/src/db/__tests__/_helpers";
import { accounts, assets, assetTransactions } from "@/src/db/schema";
import { recomputeLotsForAsset } from "../lots";
import { buildTaxReport } from "../report";

describe("buildTaxReport", () => {
  it("aggregates realised gains, losses, non-computable, and dividends for a year", () => {
    const db = createTestDb();
    const accountId = ulid();
    const assetId = ulid();
    db.insert(accounts).values({
      id: accountId, name: "DEGIRO", currency: "EUR",
      accountType: "broker", countryCode: "NL",
      openingBalanceEur: 0, currentCashBalanceEur: 0,
    }).run();
    db.insert(assets).values({
      id: assetId, name: "UNITEDHEALTH GROUP INC", assetType: "equity",
      isin: "US91324P1021", currency: "USD", isActive: true,
      assetClassTax: "listed_security",
    }).run();

    const DAY = 86_400_000;
    const t = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

    function insert(txn: any) { db.insert(assetTransactions).values(txn).run(); }

    // Buy 10 @ 100 EUR on 2025-01-10
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "buy", tradedAt: t(2025, 1, 10),
      quantity: 10, unitPrice: 100, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1000, tradeGrossAmountEur: 1000, cashImpactEur: -1000,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: -1000,
      isListed: true, source: "manual",
    });
    // Sell 10 @ 150 EUR on 2025-06-01 → gain 500
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "sell", tradedAt: t(2025, 6, 1),
      quantity: 10, unitPrice: 150, tradeCurrency: "EUR", fxRateToEur: 1,
      tradeGrossAmount: 1500, tradeGrossAmountEur: 1500, cashImpactEur: 1500,
      feesAmount: 0, feesAmountEur: 0, netAmountEur: 1500,
      isListed: true, source: "manual",
    });
    // Dividend 2025-03-17, $6.63 gross, $0.99 retención origen
    insert({
      id: ulid(), accountId, assetId,
      transactionType: "dividend", tradedAt: t(2025, 3, 17),
      quantity: 0, unitPrice: 0, tradeCurrency: "USD", fxRateToEur: 0.92,
      tradeGrossAmount: 6.63, tradeGrossAmountEur: 6.10,
      cashImpactEur: 5.19, feesAmount: 0, feesAmountEur: 0,
      netAmountEur: 5.19,
      dividendGross: 6.63, dividendNet: 5.64, withholdingTax: 0.91,
      sourceCountry: "US", isListed: true, source: "manual",
    });

    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));
    const report = buildTaxReport(db, 2025);

    expect(report.totals.realizedGainsEur).toBeCloseTo(500, 2);
    expect(report.totals.realizedLossesComputableEur).toBe(0);
    expect(report.totals.nonComputableLossesEur).toBe(0);
    expect(report.sales).toHaveLength(1);
    expect(report.sales[0].consumedLots).toHaveLength(1);

    expect(report.dividends).toHaveLength(1);
    expect(report.dividends[0].sourceCountry).toBe("US");
    expect(report.dividends[0].grossEur).toBeCloseTo(6.10, 2);
    expect(report.dividends[0].withholdingOrigenEur).toBeCloseTo(0.91, 2);
    expect(report.totals.dividendsGrossEur).toBeCloseTo(6.10, 2);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test report.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/tax/report.ts`**

```ts
import { and, eq, gte, lt } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  assetTransactions,
  assets,
  accounts,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../../db/schema";

export type ConsumedLotSummary = {
  lotId: string;
  acquiredAt: number;
  qtyConsumed: number;
  costBasisEur: number;
};

export type SaleReportRow = {
  transactionId: string;
  tradedAt: number;
  accountId: string;
  assetId: string;
  quantity: number;
  proceedsEur: number;
  feesEur: number;
  costBasisEur: number;
  rawGainLossEur: number;
  nonComputableLossEur: number;
  computableGainLossEur: number;
  consumedLots: ConsumedLotSummary[];
  assetName: string | null;
  isin: string | null;
  assetClassTax: string | null;
};

export type DividendReportRow = {
  transactionId: string;
  tradedAt: number;
  accountId: string;
  assetId: string;
  assetName: string | null;
  isin: string | null;
  sourceCountry: string | null;
  grossNative: number;
  grossEur: number;
  withholdingOrigenEur: number;
  withholdingDestinoEur: number;
  netEur: number;
};

export type TaxReport = {
  year: number;
  sales: SaleReportRow[];
  dividends: DividendReportRow[];
  totals: {
    realizedGainsEur: number;
    realizedLossesComputableEur: number;
    nonComputableLossesEur: number;
    netComputableEur: number;
    proceedsEur: number;
    costBasisEur: number;
    feesEur: number;
    dividendsGrossEur: number;
    withholdingOrigenTotalEur: number;
    withholdingDestinoTotalEur: number;
  };
};

function yearBounds(year: number): { start: number; end: number } {
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
}

export function buildTaxReport(db: DB, year: number): TaxReport {
  const { start, end } = yearBounds(year);

  const sellRows = db
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.transactionType, "sell"),
        gte(assetTransactions.tradedAt, start),
        lt(assetTransactions.tradedAt, end),
      ),
    )
    .all();

  const assetIds = new Set<string>();
  sellRows.forEach((r) => assetIds.add(r.assetId));

  const sales: SaleReportRow[] = [];

  for (const row of sellRows) {
    const consumptions = db
      .select()
      .from(taxLotConsumptions)
      .where(eq(taxLotConsumptions.saleTransactionId, row.id))
      .all();

    const lotIds = consumptions.map((c) => c.lotId);
    const lotRows = lotIds.length
      ? db.select().from(taxLots).where(eqAny(taxLots.id, lotIds)).all()
      : [];
    const lotById = new Map(lotRows.map((l) => [l.id, l]));

    const costBasisEur = consumptions.reduce((s, c) => s + c.costBasisEur, 0);
    const rawGainLoss = row.tradeGrossAmountEur - costBasisEur - row.feesAmountEur;

    const adjustments = db
      .select()
      .from(taxWashSaleAdjustments)
      .where(eq(taxWashSaleAdjustments.saleTransactionId, row.id))
      .all();
    const nonComputable = adjustments.reduce((s, a) => s + a.disallowedLossEur, 0);
    // Disallowed loss reduces the loss: if raw is -200 and 60 is disallowed,
    // computable is -140.
    const computable = rawGainLoss < 0 ? rawGainLoss + nonComputable : rawGainLoss;

    const asset = db.select().from(assets).where(eq(assets.id, row.assetId)).get();

    sales.push({
      transactionId: row.id,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      quantity: row.quantity,
      proceedsEur: row.tradeGrossAmountEur,
      feesEur: row.feesAmountEur,
      costBasisEur,
      rawGainLossEur: rawGainLoss,
      nonComputableLossEur: nonComputable,
      computableGainLossEur: computable,
      consumedLots: consumptions.map((c) => ({
        lotId: c.lotId,
        acquiredAt: lotById.get(c.lotId)?.acquiredAt ?? 0,
        qtyConsumed: c.qtyConsumed,
        costBasisEur: c.costBasisEur,
      })),
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      assetClassTax: asset?.assetClassTax ?? null,
    });
  }

  sales.sort((a, b) => a.tradedAt - b.tradedAt);

  const dividendRows = db
    .select()
    .from(assetTransactions)
    .where(
      and(
        eq(assetTransactions.transactionType, "dividend"),
        gte(assetTransactions.tradedAt, start),
        lt(assetTransactions.tradedAt, end),
      ),
    )
    .all();

  const dividends: DividendReportRow[] = dividendRows.map((row) => {
    const asset = db.select().from(assets).where(eq(assets.id, row.assetId)).get();
    return {
      transactionId: row.id,
      tradedAt: row.tradedAt,
      accountId: row.accountId,
      assetId: row.assetId,
      assetName: asset?.name ?? null,
      isin: asset?.isin ?? null,
      sourceCountry: row.sourceCountry,
      grossNative: row.dividendGross ?? row.tradeGrossAmount,
      grossEur: row.tradeGrossAmountEur,
      withholdingOrigenEur: (row.withholdingTax ?? 0) * row.fxRateToEur,
      withholdingDestinoEur: row.withholdingTaxDestination ?? 0,
      netEur: row.cashImpactEur,
    };
  });
  dividends.sort((a, b) => a.tradedAt - b.tradedAt);

  let realizedGainsEur = 0;
  let realizedLossesComputableEur = 0;
  let nonComputableLossesEur = 0;
  let proceedsEur = 0;
  let costBasisEur = 0;
  let feesEur = 0;
  for (const s of sales) {
    if (s.computableGainLossEur >= 0) realizedGainsEur += s.computableGainLossEur;
    else realizedLossesComputableEur += s.computableGainLossEur;
    nonComputableLossesEur += s.nonComputableLossEur;
    proceedsEur += s.proceedsEur;
    costBasisEur += s.costBasisEur;
    feesEur += s.feesEur;
  }

  let dividendsGrossEur = 0;
  let withholdingOrigenTotalEur = 0;
  let withholdingDestinoTotalEur = 0;
  for (const d of dividends) {
    dividendsGrossEur += d.grossEur;
    withholdingOrigenTotalEur += d.withholdingOrigenEur;
    withholdingDestinoTotalEur += d.withholdingDestinoEur;
  }

  return {
    year,
    sales,
    dividends,
    totals: {
      realizedGainsEur,
      realizedLossesComputableEur,
      nonComputableLossesEur,
      netComputableEur: realizedGainsEur + realizedLossesComputableEur,
      proceedsEur,
      costBasisEur,
      feesEur,
      dividendsGrossEur,
      withholdingOrigenTotalEur,
      withholdingDestinoTotalEur,
    },
  };
}

// Tiny helper to avoid pulling `inArray` into every call site.
import { inArray } from "drizzle-orm";
function eqAny<T extends { _: { dataType: string } }>(col: T, ids: string[]) {
  return inArray(col as any, ids);
}
```

- [ ] **Step 4: Run and verify**

Run: `pnpm test report.test`
Expected: PASS.

- [ ] **Step 5: Update `src/server/taxes.ts` to delegate**

Replace the contents with a shim that keeps the existing `/taxes` page compiling. The shim exposes `getTaxYears`, `computeRealizedGainsForYear`, `computeDividendAndInterestForYear` as before but derives their outputs from `buildTaxReport`:

```ts
import { db as defaultDb, type DB } from "../db/client";
import { accountCashMovements, assetTransactions } from "../db/schema";
import { buildTaxReport } from "./tax/report";

export async function getTaxYears(db: DB = defaultDb): Promise<number[]> {
  const rows = await db.select({ tradedAt: assetTransactions.tradedAt }).from(assetTransactions).all();
  const cashRows = await db.select({ occurredAt: accountCashMovements.occurredAt }).from(accountCashMovements).all();
  const years = new Set<number>();
  for (const r of rows) years.add(new Date(r.tradedAt).getUTCFullYear());
  for (const r of cashRows) years.add(new Date(r.occurredAt).getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}

export type RealizedSale = {
  saleId: string;
  sellDate: number;
  accountId: string;
  accountName: string | null;
  assetId: string;
  assetName: string | null;
  quantity: number;
  proceedsEur: number;
  costBasisEur: number;
  feesEur: number;
  realizedGainEur: number;
};

export type RealizedGainsYearResult = {
  sales: RealizedSale[];
  totals: {
    realizedGainsEur: number;
    realizedLossesEur: number;
    netRealizedEur: number;
    proceedsEur: number;
    costBasisEur: number;
    feesEur: number;
  };
};

export async function computeRealizedGainsForYear(
  year: number,
  db: DB = defaultDb,
): Promise<RealizedGainsYearResult> {
  const report = buildTaxReport(db, year);
  const sales: RealizedSale[] = report.sales.map((s) => ({
    saleId: s.transactionId,
    sellDate: s.tradedAt,
    accountId: s.accountId,
    accountName: null,
    assetId: s.assetId,
    assetName: s.assetName,
    quantity: s.quantity,
    proceedsEur: s.proceedsEur,
    costBasisEur: s.costBasisEur,
    feesEur: s.feesEur,
    realizedGainEur: s.computableGainLossEur,
  }));
  return {
    sales,
    totals: {
      realizedGainsEur: report.totals.realizedGainsEur,
      realizedLossesEur: report.totals.realizedLossesComputableEur,
      netRealizedEur: report.totals.netComputableEur,
      proceedsEur: report.totals.proceedsEur,
      costBasisEur: report.totals.costBasisEur,
      feesEur: report.totals.feesEur,
    },
  };
}

export type DividendInterestYearResult = {
  dividendsEur: number;
  interestEur: number;
  totalEur: number;
};

export async function computeDividendAndInterestForYear(
  year: number,
  db: DB = defaultDb,
): Promise<DividendInterestYearResult> {
  const report = buildTaxReport(db, year);
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const rows = await db.select().from(accountCashMovements).all();
  let interestEur = 0;
  for (const r of rows) {
    if (r.occurredAt < start || r.occurredAt >= end) continue;
    if (r.movementType === "interest") interestEur += r.cashImpactEur;
  }
  return {
    dividendsEur: report.totals.dividendsGrossEur,
    interestEur,
    totalEur: report.totals.dividendsGrossEur + interestEur,
  };
}
```

- [ ] **Step 6: Ensure the old test still passes**

Run: `pnpm test src/server/taxes.test`
Expected: PASS (the legacy test still exercises the shim shape). If it fails, fix the shim to match expectations.

- [ ] **Step 7: Commit**

```bash
git add src/server/tax/report.ts src/server/tax/__tests__/report.test.ts src/server/taxes.ts
git commit -m "feat(tax): buildTaxReport backed by persisted lots; shim legacy API"
```

---

## Task 9: Hook recompute into `createTransaction`

**Files:**
- Modify: `src/actions/createTransaction.ts`

- [ ] **Step 1: Add recompute call**

At the top, add `import { recomputeLotsForAsset } from "../server/tax/lots";`. Inside the `db.transaction` block, after `recomputeAssetPosition(tx, data.accountId, data.assetId);`, add:

```ts
recomputeLotsForAsset(tx, data.assetId);
```

- [ ] **Step 2: Guard cash movement for non-cash-tracking accounts**

Still inside the transaction, wrap the `tx.insert(accountCashMovements)` block in a conditional:

```ts
const tracksCash = account.accountType === "bank" || account.accountType === "savings";
if (tracksCash) {
  tx.insert(accountCashMovements).values({ /* existing */ }).run();
  recomputeAccountCashBalance(tx, data.accountId);
}
```

(Remove the current unconditional `recomputeAccountCashBalance` call.)

- [ ] **Step 3: Run existing suite**

Run: `pnpm test && pnpm typecheck`
Expected: all pass. Any broken tests likely assumed cash movements on broker accounts — update those tests to either use a bank account or skip the cash-movement assertion. Document each change in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/actions/createTransaction.ts src/actions/__tests__/
git commit -m "feat(tx): recompute tax lots on createTransaction; skip cash movement on broker/crypto/wallet"
```

---

## Task 10: Hook recompute into `confirmImport` and `deleteTransaction`

**Files:**
- Modify: `src/actions/confirmImport.ts`
- Modify: `src/actions/deleteTransaction.ts`

- [ ] **Step 1: `confirmImport.ts`**

After the transaction is inserted and positions recomputed, collect the set of `assetId`s touched in this import batch and call:

```ts
for (const assetId of affectedAssetIds) recomputeLotsForAsset(tx, assetId);
```

Apply the same cash-tracking guard as Task 9 wherever `accountCashMovements` insert occurs.

- [ ] **Step 2: `deleteTransaction.ts`**

Identify the deleted row's `assetId` before deletion, then after the delete call `recomputeLotsForAsset(tx, assetId)`. Apply cash-tracking guard if this action also touches `accountCashMovements`.

- [ ] **Step 3: Typecheck + existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/actions/confirmImport.ts src/actions/deleteTransaction.ts
git commit -m "feat(actions): recompute tax lots on import and delete; respect cash-tracking rule"
```

---

## Task 11: Cash-balance no-op for non-cash-tracking accounts

**Files:**
- Modify: `src/server/recompute.ts`

- [ ] **Step 1: Read current `recomputeAccountCashBalance`**

Open `src/server/recompute.ts` and locate `recomputeAccountCashBalance`. Read the entire function.

- [ ] **Step 2: Add early return**

At the top of the function body, add:

```ts
const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
if (!account) return;
const tracksCash = account.accountType === "bank" || account.accountType === "savings";
if (!tracksCash) {
  tx.update(accounts).set({ currentCashBalanceEur: 0 }).where(eq(accounts.id, accountId)).run();
  return;
}
```

Ensure `accounts` and `eq` are imported.

- [ ] **Step 3: Run all tests**

Run: `pnpm test && pnpm typecheck`
Expected: pass. Fix any test that seeded a broker account and expected a non-zero `currentCashBalanceEur`.

- [ ] **Step 4: Commit**

```bash
git add src/server/recompute.ts
git commit -m "feat(accounts): zero out cash balance for broker/crypto/wallet accounts"
```

---

## Task 12: Backfill script — asset_class_tax

**Files:**
- Create: `scripts/backfill-asset-class.ts`

- [ ] **Step 1: Write the script**

```ts
import { db } from "../src/db/client";
import { assets } from "../src/db/schema";
import { eq, isNull } from "drizzle-orm";
import { inferAssetClassTax } from "../src/server/tax/classification";

async function main() {
  const rows = db.select().from(assets).where(isNull(assets.assetClassTax)).all();
  let updated = 0;
  for (const row of rows) {
    const cls = inferAssetClassTax({
      assetType: row.assetType,
      subtype: row.subtype,
      name: row.name,
      ticker: row.ticker,
      isin: row.isin,
    });
    db.update(assets).set({ assetClassTax: cls }).where(eq(assets.id, row.id)).run();
    updated++;
    console.log(`  ${row.isin ?? row.id} (${row.name}) → ${cls}`);
  }
  console.log(`\nBackfilled asset_class_tax for ${updated} assets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add to `package.json` scripts**

Add: `"backfill:asset-class": "tsx scripts/backfill-asset-class.ts"`.

- [ ] **Step 3: Run once against the dev DB**

Run: `pnpm backfill:asset-class`
Expected: prints a classification per asset.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-asset-class.ts package.json
git commit -m "chore(tax): backfill asset_class_tax for existing assets"
```

---

## Task 13: Backfill script — tax lots for existing transactions

**Files:**
- Create: `scripts/backfill-tax-lots.ts`

- [ ] **Step 1: Write the script**

```ts
import { db } from "../src/db/client";
import { assetTransactions } from "../src/db/schema";
import { recomputeLotsForAsset } from "../src/server/tax/lots";

async function main() {
  const rows = db.select({ assetId: assetTransactions.assetId }).from(assetTransactions).all();
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  console.log(`Recomputing lots for ${assetIds.length} assets…`);
  db.transaction((tx) => {
    for (const id of assetIds) recomputeLotsForAsset(tx, id);
  });
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add to `package.json` scripts**

Add: `"backfill:tax-lots": "tsx scripts/backfill-tax-lots.ts"`.

- [ ] **Step 3: Run**

Run: `pnpm backfill:tax-lots`
Expected: no error, prints asset count.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-tax-lots.ts package.json
git commit -m "chore(tax): backfill tax_lots from existing asset_transactions"
```

---

## Task 14: DEGIRO Account Statement parser — fixture + shape

**Files:**
- Create: `src/lib/imports/__fixtures__/degiro-statement.sample.csv`
- Create: `src/lib/imports/degiro-statement.ts` (stub)
- Create: `src/lib/imports/__tests__/degiro-statement.test.ts`
- Modify: `src/lib/imports/types.ts`

- [ ] **Step 1: Copy the spec sample into the fixture folder**

Run:
```bash
mkdir -p src/lib/imports/__fixtures__
cp docs/superpowers/specs/2026-04-19-statement-sample.csv src/lib/imports/__fixtures__/degiro-statement.sample.csv
```

- [ ] **Step 2: Extend `types.ts`**

In `src/lib/imports/types.ts`:
- Add `"degiro-statement"` to the `ImportSource` / source union.
- Add the dividend parsed-row shape to `ParsedImportRow` as a new discriminated variant:
  ```ts
  | {
      kind: "dividend";
      source: "degiro-statement";
      tradedAt: number;
      isin: string;
      productName: string;
      grossNative: number;
      currency: string;
      fxRateToEur: number;
      grossEur: number;
      withholdingOrigenNative: number;
      withholdingOrigenEur: number;
      withholdingDestinoEur: number;
      sourceCountry: string | null;
      rowFingerprint: string;
      rawPayload: string;
    }
  ```
  Include existing `buy`/`sell`/other shapes unchanged. If `ParsedImportRow` isn't already discriminated, introduce a `kind` field consistently.

- [ ] **Step 3: Write parser stub**

Create `src/lib/imports/degiro-statement.ts`:

```ts
import type { ImportParseResult } from "./types";

export function parseDegiroStatementCsv(csv: string): ImportParseResult {
  return { source: "degiro-statement", rows: [], errors: [{ line: 0, message: "not implemented" }] };
}
```

- [ ] **Step 4: Write failing test**

Create `src/lib/imports/__tests__/degiro-statement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDegiroStatementCsv } from "../degiro-statement";

const FIXTURE = readFileSync(join(__dirname, "../__fixtures__/degiro-statement.sample.csv"), "utf8");

describe("parseDegiroStatementCsv", () => {
  const result = parseDegiroStatementCsv(FIXTURE);

  it("produces no parse errors for the sample", () => {
    expect(result.errors).toHaveLength(0);
  });

  it("extracts every trade (Compra row) with correct qty and price", () => {
    const buys = result.rows.filter((r) => r.kind === "buy");
    // Per the fixture: 10 distinct Compra lines across 2025–2026.
    expect(buys.length).toBe(10);
    const unitedHealth = buys.find((b) => b.kind === "buy" && b.isin === "US91324P1021");
    expect(unitedHealth).toBeDefined();
    if (unitedHealth && unitedHealth.kind === "buy") {
      expect(unitedHealth.quantity).toBe(3);
      expect(unitedHealth.priceNative).toBeCloseTo(309.98, 4);
      expect(unitedHealth.currency).toBe("USD");
    }
  });

  it("extracts dividends and pairs them with retención origen + FX rate", () => {
    const dividends = result.rows.filter((r) => r.kind === "dividend");
    // 3 UNH dividend events in the sample (17-12-2025, 17-03-2026, 23-09-2025)
    expect(dividends.length).toBe(3);
    const div = dividends[0];
    if (div.kind === "dividend") {
      expect(div.isin).toBe("US91324P1021");
      expect(div.grossNative).toBeCloseTo(6.63, 2);
      expect(div.currency).toBe("USD");
      expect(div.withholdingOrigenNative).toBeCloseTo(0.99, 2);
      expect(div.sourceCountry).toBe("US");
      // FX rate from the auto-conversion legs
      expect(div.fxRateToEur).toBeGreaterThan(0);
      expect(div.grossEur).toBeGreaterThan(5.4);
      expect(div.grossEur).toBeLessThan(6.1);
    }
  });

  it("ignores cash sweep plumbing, deposits, interest, connectivity fees on broker accounts", () => {
    const otherKinds = result.rows.filter((r) => r.kind !== "buy" && r.kind !== "sell" && r.kind !== "dividend");
    expect(otherKinds).toHaveLength(0);
  });

  it("folds per-trade connectivity/transaction fees into the buy row", () => {
    const vanguard = result.rows.find((r) => r.kind === "buy" && r.isin === "IE00BK5BQT80" && r.quantity === 115);
    if (vanguard && vanguard.kind === "buy") {
      expect(vanguard.feesNative).toBeCloseTo(1.0, 2);
      expect(vanguard.currency).toBe("EUR");
    } else {
      throw new Error("expected Vanguard 115-unit buy row");
    }
  });

  it("produces stable rowFingerprint for dedup", () => {
    const second = parseDegiroStatementCsv(FIXTURE);
    const firstFps = result.rows.map((r) => (r as any).rowFingerprint).sort();
    const secondFps = second.rows.map((r) => (r as any).rowFingerprint).sort();
    expect(secondFps).toEqual(firstFps);
  });
});
```

- [ ] **Step 5: Run and verify failure**

Run: `pnpm test degiro-statement.test`
Expected: FAIL — stub returns no rows.

- [ ] **Step 6: Commit the failing test**

```bash
git add src/lib/imports/__fixtures__ src/lib/imports/degiro-statement.ts src/lib/imports/__tests__/degiro-statement.test.ts src/lib/imports/types.ts
git commit -m "test(imports): failing spec for degiro-statement parser"
```

---

## Task 15: DEGIRO statement parser — row classification + grouping

**Files:**
- Modify: `src/lib/imports/degiro-statement.ts`

- [ ] **Step 1: Implement the parser**

Replace the stub with the full implementation. The algorithm:

1. **Parse CSV** using `parseCsv` from `./_shared` (already exists). Headers: `Date, Time, Value date, Product, ISIN, Description, FX, Change, Change Ccy (unnamed), Balance, Balance Ccy (unnamed), Order Id`.
2. **Normalise** each row: parse EU decimals (`"1.924,05"` → 1924.05) via an `parseEuDecimal` helper, parse `DD-MM-YYYY` via an `parseEuDate` helper, assign positional currency columns.
3. **Classify** by `Description` prefix into one of: `trade-buy`, `trade-sell`, `trade-fee`, `trade-fx-leg`, `dividend-gross`, `dividend-wht-origen`, `dividend-wht-destino`, `dividend-fx-leg`, `adr-fee`, `deposit`, `interest`, `sweep`, `sweep-counterleg`, `connectivity-fee`, `misc-credit`, `unknown`.
4. **Group trades by `Order Id`**. Each group yields one `buy`/`sell` with the `Compra/Venta` row's qty & price, the `trade-fee` row summed into fees, and the `trade-fx-leg` pair used to set `fxRateToEur` (when present — otherwise `fxRateToEur = 1` for EUR trades).
5. **Pair dividends**: for each `dividend-gross` row, find the matching `dividend-wht-origen` (same ISIN, `|date diff| ≤ 3 days`) and the FX-conversion pair (two `dividend-fx-leg` rows without Order Id, same USD amount sign-flipped, within ±3 days). Compute `fxRateToEur` = the EUR leg's absolute amount / USD leg's absolute amount. `grossEur = grossNative / fxRate` when `currency=USD`; for EUR dividends `fxRate=1`.
6. **Suppress** on broker accounts: `deposit`, `interest`, `sweep`, `sweep-counterleg`, `connectivity-fee`, `misc-credit`, `adr-fee` → not emitted.
7. **Unknown rows** → emitted as `errors`.
8. **Fingerprint** = sha1 of `date|time|valueDate|isin|description|changeAmount|changeCcy|balanceAmount`.

```ts
import { createHash } from "node:crypto";
import { parseCsv } from "./_shared";
import { countryFromIsin } from "../../server/tax/countries";
import type { ImportParseError, ImportParseResult, ParsedImportRow } from "./types";

const SOURCE = "degiro-statement" as const;
const DAY = 86_400_000;

type Raw = {
  lineNo: number;
  date: string; time: string; valueDate: string;
  product: string; isin: string; description: string;
  fx: string;
  changeAmount: number | null; changeCcy: string;
  balanceAmount: number | null; balanceCcy: string;
  orderId: string;
  raw: string;
  ts: number;
};

function parseEuDecimal(s: string): number | null {
  const t = s.trim().replace(/\./g, "").replace(/,/g, ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseEuDate(date: string, time: string): number {
  const [d, m, y] = date.split("-").map((x) => Number.parseInt(x, 10));
  const [hh, mm] = (time || "00:00").split(":").map((x) => Number.parseInt(x, 10));
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
}

function fp(raw: Raw): string {
  return createHash("sha1").update([
    raw.date, raw.time, raw.valueDate, raw.isin, raw.description,
    raw.changeAmount, raw.changeCcy, raw.balanceAmount,
  ].join("|")).digest("hex");
}

function parseRaw(rows: string[][]): Raw[] {
  return rows.slice(1).map((r, i) => ({
    lineNo: i + 2,
    date: (r[0] ?? "").trim(),
    time: (r[1] ?? "").trim(),
    valueDate: (r[2] ?? "").trim(),
    product: (r[3] ?? "").trim(),
    isin: (r[4] ?? "").trim(),
    description: (r[5] ?? "").trim(),
    fx: (r[6] ?? "").trim(),
    changeAmount: parseEuDecimal(r[8] ?? ""),
    changeCcy: (r[7] ?? "").trim(),
    balanceAmount: parseEuDecimal(r[10] ?? ""),
    balanceCcy: (r[9] ?? "").trim(),
    orderId: (r[11] ?? "").trim(),
    raw: r.join(","),
    ts: parseEuDate((r[0] ?? ""), (r[1] ?? "")),
  }));
}

const RX_COMPRA = /^Compra\s+([\d.,]+)\s+.+@([\d.,]+)\s+([A-Z]{3})\s+\(([A-Z0-9]+)\)/i;
const RX_VENTA  = /^Venta\s+([\d.,]+)\s+.+@([\d.,]+)\s+([A-Z]{3})\s+\(([A-Z0-9]+)\)/i;

type ClassKind =
  | "trade" | "trade-fee" | "trade-fx"
  | "dividend-gross" | "dividend-wht-origen" | "dividend-wht-destino" | "dividend-fx"
  | "adr-fee" | "deposit" | "interest" | "sweep" | "sweep-counterleg"
  | "connectivity-fee" | "misc-credit" | "unknown";

function classify(raw: Raw): ClassKind {
  const d = raw.description.toLowerCase();
  if (/^compra\b|^venta\b/.test(d)) return "trade";
  if (d.startsWith("costes de transacción") && raw.orderId) return "trade-fee";
  if ((d.startsWith("ingreso cambio de divisa") || d.startsWith("retirada cambio de divisa")) && raw.orderId) return "trade-fx";
  if (d.startsWith("dividendo")) return "dividend-gross";
  if (d.startsWith("retención del dividendo")) return "dividend-wht-origen";
  if (d.startsWith("impuesto sobre dividendo")) return "dividend-wht-destino";
  if ((d.startsWith("ingreso cambio de divisa") || d.startsWith("retirada cambio de divisa")) && !raw.orderId) return "dividend-fx";
  if (d.startsWith("adr/gdr pass-through fee")) return "adr-fee";
  if (d.startsWith("flatex deposit")) return "deposit";
  if (d.startsWith("flatex interest income")) return "interest";
  if (d.startsWith("degiro cash sweep transfer")) return "sweep";
  if (d.startsWith("transferir")) return "sweep-counterleg";
  if (d.startsWith("comisión de conectividad")) return "connectivity-fee";
  if (d === "ingreso") return "misc-credit";
  return "unknown";
}

export function parseDegiroStatementCsv(csv: string): ImportParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { source: SOURCE, rows: [], errors: [] };

  const raws = parseRaw(rows);
  const klass = new Map<Raw, ClassKind>();
  for (const r of raws) klass.set(r, classify(r));

  const out: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  // 1. Group trades by Order Id.
  const byOrder = new Map<string, Raw[]>();
  for (const r of raws) {
    if (!r.orderId) continue;
    const k = klass.get(r)!;
    if (k !== "trade" && k !== "trade-fee" && k !== "trade-fx") continue;
    if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
    byOrder.get(r.orderId)!.push(r);
  }

  for (const [orderId, group] of byOrder) {
    const tradeRow = group.find((r) => klass.get(r) === "trade");
    if (!tradeRow) continue;
    const m = RX_COMPRA.exec(tradeRow.description) ?? RX_VENTA.exec(tradeRow.description);
    if (!m) {
      errors.push({ line: tradeRow.lineNo, message: `unparseable trade: ${tradeRow.description}` });
      continue;
    }
    const side: "buy" | "sell" = RX_COMPRA.test(tradeRow.description) ? "buy" : "sell";
    const qty = parseEuDecimal(m[1]) ?? 0;
    const price = parseEuDecimal(m[2]) ?? 0;
    const tradeCcy = m[3];
    const isin = m[4];

    const feeRow = group.find((r) => klass.get(r) === "trade-fee");
    const feesNative = feeRow && feeRow.changeAmount != null ? Math.abs(feeRow.changeAmount) : 0;

    const fxLegs = group.filter((r) => klass.get(r) === "trade-fx");
    let fxRateToEur = 1;
    if (tradeCcy !== "EUR" && fxLegs.length === 2) {
      const eurLeg = fxLegs.find((r) => r.changeCcy === "EUR");
      const nativeLeg = fxLegs.find((r) => r.changeCcy === tradeCcy);
      if (eurLeg?.changeAmount && nativeLeg?.changeAmount) {
        fxRateToEur = Math.abs(eurLeg.changeAmount) / Math.abs(nativeLeg.changeAmount);
      } else if (nativeLeg?.fx) {
        // Some rows only have the FX rate on the native leg ("1,1481").
        const rate = parseEuDecimal(nativeLeg.fx);
        if (rate && rate > 0) fxRateToEur = 1 / rate;
      }
    }

    out.push({
      kind: side,
      source: SOURCE,
      tradedAt: tradeRow.ts,
      isin,
      productName: tradeRow.product,
      quantity: qty,
      priceNative: price,
      currency: tradeCcy,
      fxRateToEur,
      feesNative,
      orderId,
      rowFingerprint: fp(tradeRow),
      rawPayload: group.map((g) => g.raw).join("\n"),
    } as ParsedImportRow);
  }

  // 2. Pair dividends.
  const dividendGross = raws.filter((r) => klass.get(r) === "dividend-gross");
  for (const div of dividendGross) {
    const whtO = raws.find((r) =>
      klass.get(r) === "dividend-wht-origen" &&
      r.isin === div.isin &&
      Math.abs(r.ts - div.ts) <= 3 * DAY,
    );
    const whtD = raws.find((r) =>
      klass.get(r) === "dividend-wht-destino" &&
      r.isin === div.isin &&
      Math.abs(r.ts - div.ts) <= 3 * DAY,
    );

    // Match FX conversion pair: two rows without orderId, same ISIN/timeframe, EUR+native currency.
    const fxPair = raws
      .filter((r) => klass.get(r) === "dividend-fx" && Math.abs(r.ts - div.ts) <= 5 * DAY)
      .slice(0, 10);
    const eurLeg = fxPair.find((r) => r.changeCcy === "EUR");
    const nativeLeg = fxPair.find((r) => r.changeCcy === div.changeCcy);
    let fxRateToEur = 1;
    if (div.changeCcy !== "EUR" && eurLeg?.changeAmount && nativeLeg?.changeAmount) {
      fxRateToEur = Math.abs(eurLeg.changeAmount) / Math.abs(nativeLeg.changeAmount);
    } else if (div.changeCcy !== "EUR" && nativeLeg?.fx) {
      const rate = parseEuDecimal(nativeLeg.fx);
      if (rate && rate > 0) fxRateToEur = 1 / rate;
    }

    const grossNative = div.changeAmount ?? 0;
    const whtOrigenNative = whtO ? Math.abs(whtO.changeAmount ?? 0) : 0;

    out.push({
      kind: "dividend",
      source: SOURCE,
      tradedAt: div.ts,
      isin: div.isin,
      productName: div.product,
      grossNative,
      currency: div.changeCcy,
      fxRateToEur,
      grossEur: grossNative * fxRateToEur,
      withholdingOrigenNative: whtOrigenNative,
      withholdingOrigenEur: whtOrigenNative * fxRateToEur,
      withholdingDestinoEur: whtD ? Math.abs(whtD.changeAmount ?? 0) : 0,
      sourceCountry: countryFromIsin(div.isin),
      rowFingerprint: fp(div),
      rawPayload: div.raw,
    } as ParsedImportRow);
  }

  // 3. Collect unknowns as errors.
  for (const r of raws) {
    if (klass.get(r) === "unknown") {
      errors.push({ line: r.lineNo, message: `unknown description: ${r.description}` });
    }
  }

  return { source: SOURCE, rows: out, errors };
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test degiro-statement.test`
Expected: PASS all cases. If a test fails, inspect the fixture row counts and adjust the parser — do NOT weaken the test expectations.

- [ ] **Step 3: Commit**

```bash
git add src/lib/imports/degiro-statement.ts
git commit -m "feat(imports): DEGIRO Account Statement parser — trades, dividends, fee folding"
```

---

## Task 16: Wire the new parser into `confirmImport`

**Files:**
- Modify: `src/actions/confirmImport.ts`

- [ ] **Step 1: Inspect the existing confirmImport flow**

Read `src/actions/confirmImport.ts` end-to-end. It currently maps `ParsedImportRow` into `assetTransactions.insert` values for `buy` / `sell`. Extend the switch to handle `kind: "dividend"` — inserting an `asset_transactions` row with `transaction_type = "dividend"` and the new columns (`sourceCountry`, `withholdingTax` = origen EUR, `withholdingTaxDestination` = destino EUR).

- [ ] **Step 2: Handle the dividend case**

Inside the row mapping (adapt field names to existing code):

```ts
if (row.kind === "dividend") {
  const id = ulid();
  tx.insert(assetTransactions).values({
    id,
    accountId: resolvedAccountId,
    assetId: resolvedAssetId,
    transactionType: "dividend",
    tradedAt: row.tradedAt,
    quantity: 0,
    unitPrice: 0,
    tradeCurrency: row.currency,
    fxRateToEur: row.fxRateToEur,
    tradeGrossAmount: row.grossNative,
    tradeGrossAmountEur: row.grossEur,
    cashImpactEur: row.grossEur - row.withholdingOrigenEur - row.withholdingDestinoEur,
    feesAmount: 0,
    feesAmountEur: 0,
    netAmountEur: row.grossEur - row.withholdingOrigenEur - row.withholdingDestinoEur,
    dividendGross: row.grossNative,
    dividendNet: row.grossNative - row.withholdingOrigenNative,
    withholdingTax: row.withholdingOrigenEur,
    withholdingTaxDestination: row.withholdingDestinoEur,
    sourceCountry: row.sourceCountry,
    isListed: true,
    source: "degiro-statement",
    rowFingerprint: row.rowFingerprint,
    rawPayload: row.rawPayload,
  }).run();
  affectedAssetIds.add(resolvedAssetId);
  continue;
}
```

Keep the existing `buy`/`sell` branches as-is but ensure they set `isListed: true` (DEGIRO is always listed).

- [ ] **Step 3: Update the existing imports test fixture expectations if present**

Run: `pnpm test`
Fix any legacy `imports.test.ts` assertions that broke; add a new test asserting a `dividend` row from `parseDegiroStatementCsv` ends up as an `asset_transactions` row with `transaction_type='dividend'` and `source_country='US'`.

- [ ] **Step 4: Commit**

```bash
git add src/actions/confirmImport.ts src/actions/__tests__/imports.test.ts
git commit -m "feat(imports): persist DEGIRO statement dividends into asset_transactions"
```

---

## Task 17: Import wizard — recognise `degiro-statement` source

**Files:**
- Modify: whichever file hosts the import wizard's source dispatch (discover via `grep -l "parseDegiroCsv\\|parseBinanceCsv"` at start)

- [ ] **Step 1: Locate the dispatch**

Run: `grep -rn "parseDegiroCsv" src/`
The file that imports `parseDegiroCsv` and selects a parser by user choice is the dispatch site.

- [ ] **Step 2: Add `degiro-statement` as a selectable option**

Wherever the `source` select is rendered (likely `src/app/imports/new/page.tsx` or a `src/components/features/imports/...` file), add a new option with label "DEGIRO — Account Statement" and value `degiro-statement`. Extend the switch in the import preview to call `parseDegiroStatementCsv(csv)` when that option is selected.

- [ ] **Step 3: Smoke test**

Run: `pnpm dev`, open `/imports/new`, select DEGIRO — Account Statement, upload `statement.csv`, observe parse preview with dividends visible.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(imports): DEGIRO Account Statement option in import wizard"
```

---

## Task 18: `reimportAccount` action

**Files:**
- Create: `src/actions/reimportAccount.schema.ts`
- Create: `src/actions/reimportAccount.ts`
- Create: `src/actions/__tests__/reimportAccount.test.ts`

- [ ] **Step 1: Schema**

```ts
// src/actions/reimportAccount.schema.ts
import { z } from "zod";
export const reimportAccountSchema = z.object({
  accountId: z.string().min(1),
});
export type ReimportAccountInput = z.input<typeof reimportAccountSchema>;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/actions/__tests__/reimportAccount.test.ts
import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/src/db/__tests__/_helpers";
import { accounts, assets, assetTransactions, taxLots } from "@/src/db/schema";
import { recomputeLotsForAsset } from "@/src/server/tax/lots";
import { reimportAccount } from "../reimportAccount";

describe("reimportAccount", () => {
  it("wipes transactions and tax lots for the account and recomputes affected assets", async () => {
    const db = createTestDb();
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
    db.transaction((tx) => recomputeLotsForAsset(tx, assetId));
    expect(db.select().from(taxLots).all()).toHaveLength(1);

    const result = await reimportAccount({ accountId }, db);
    expect(result.ok).toBe(true);
    expect(db.select().from(assetTransactions).where(eq(assetTransactions.accountId, accountId)).all()).toHaveLength(0);
    expect(db.select().from(taxLots).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run and verify failure**

Run: `pnpm test reimportAccount.test`
Expected: FAIL.

- [ ] **Step 4: Implement `src/actions/reimportAccount.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../db/client";
import {
  accountCashMovements,
  assetTransactions,
  auditEvents,
  taxLotConsumptions,
  taxLots,
  taxWashSaleAdjustments,
} from "../db/schema";
import { recomputeLotsForAsset } from "../server/tax/lots";
import { ACTOR, type ActionResult } from "./_shared";
import { reimportAccountSchema } from "./reimportAccount.schema";

export async function reimportAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<{ deletedTransactions: number }>> {
  const parsed = reimportAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", message: "invalid input" } };
  }
  const { accountId } = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const txns = tx.select().from(assetTransactions).where(eq(assetTransactions.accountId, accountId)).all();
      const assetIds = [...new Set(txns.map((t) => t.assetId))];
      const txnIds = txns.map((t) => t.id);

      for (const id of txnIds) {
        tx.delete(taxWashSaleAdjustments).where(eq(taxWashSaleAdjustments.saleTransactionId, id)).run();
        tx.delete(taxLotConsumptions).where(eq(taxLotConsumptions.saleTransactionId, id)).run();
      }
      for (const id of txnIds) {
        tx.delete(taxLots).where(eq(taxLots.originTransactionId, id)).run();
      }
      tx.delete(assetTransactions).where(eq(assetTransactions.accountId, accountId)).run();
      tx.delete(accountCashMovements).where(eq(accountCashMovements.accountId, accountId)).run();

      for (const assetId of assetIds) {
        recomputeLotsForAsset(tx, assetId);
      }

      tx.insert(auditEvents).values({
        id: ulid(),
        entityType: "account",
        entityId: accountId,
        action: "reimport-wipe",
        actorType: "user",
        source: "ui",
        summary: `wiped ${txns.length} transactions`,
        previousJson: JSON.stringify({ count: txns.length }),
        nextJson: null,
        contextJson: JSON.stringify({ actor: ACTOR }),
        createdAt: Date.now(),
      }).run();

      return { deletedTransactions: txns.length };
    });

    revalidatePath("/accounts");
    revalidatePath(`/accounts/${accountId}`);
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

- [ ] **Step 5: Run test**

Run: `pnpm test reimportAccount.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/reimportAccount.ts src/actions/reimportAccount.schema.ts src/actions/__tests__/reimportAccount.test.ts
git commit -m "feat(accounts): reimportAccount action — wipes transactions, lots, cash movements"
```

---

## Task 19: Re-import button on `/accounts/[id]`

**Files:**
- Modify: `src/app/accounts/[id]/page.tsx` (or the closest account detail file)
- Modify: account detail component — add a button + `ConfirmModal`

- [ ] **Step 1: Locate the account detail page**

Run: `grep -rln "params.*id" src/app/accounts/`

- [ ] **Step 2: Add a "Re-import account" action button**

In the account detail header, add a `<Button variant="destructive">` labelled "Re-import account". On click, open `ConfirmModal` with title "Wipe and re-import this account?" and body describing that all trades, cash movements, and tax lots for the account will be deleted. On confirm, call `reimportAccount({ accountId })`; on success, `router.push('/imports/new?accountId=' + accountId)`.

Follow existing primitives from `src/components/ui/` (`Button`, `ConfirmModal`). Do not raw-render a `<button>` or `<dialog>`.

- [ ] **Step 3: Smoke test manually**

Run: `pnpm dev`. On `/accounts/<id>`, click the button, confirm, verify redirect + empty account state.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(accounts): Re-import account button with ConfirmModal"
```

---

## Task 20: End-to-end fixture — statement.csv → tax report

**Files:**
- Create: `src/lib/imports/__tests__/degiro-statement-e2e.test.ts`

- [ ] **Step 1: Write end-to-end test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/src/db/__tests__/_helpers";
import { accounts, assets, assetTransactions } from "@/src/db/schema";
import { parseDegiroStatementCsv } from "../degiro-statement";
import { recomputeLotsForAsset } from "@/src/server/tax/lots";
import { buildTaxReport } from "@/src/server/tax/report";
import { inferAssetClassTax } from "@/src/server/tax/classification";

const FIXTURE = readFileSync(join(__dirname, "../__fixtures__/degiro-statement.sample.csv"), "utf8");

describe("DEGIRO statement → tax report end-to-end", () => {
  it("imports the fixture and produces a non-empty 2025 report", () => {
    const db = createTestDb();
    const accountId = ulid();
    db.insert(accounts).values({ id: accountId, name: "DEGIRO", currency: "EUR", accountType: "broker", countryCode: "NL", openingBalanceEur: 0, currentCashBalanceEur: 0 }).run();

    const parsed = parseDegiroStatementCsv(FIXTURE);
    expect(parsed.errors).toHaveLength(0);

    // Materialise assets on the fly from unique ISINs.
    const assetIdByIsin = new Map<string, string>();
    for (const row of parsed.rows) {
      const isin = (row as any).isin as string;
      if (assetIdByIsin.has(isin)) continue;
      const id = ulid();
      const name = (row as any).productName as string;
      const cls = inferAssetClassTax({ assetType: "equity", name, isin });
      db.insert(assets).values({ id, name, assetType: "equity", isin, currency: "EUR", isActive: true, assetClassTax: cls }).run();
      assetIdByIsin.set(isin, id);
    }

    // Insert trades + dividends.
    for (const row of parsed.rows) {
      const assetId = assetIdByIsin.get((row as any).isin)!;
      if (row.kind === "buy" || row.kind === "sell") {
        const grossNative = row.quantity * row.priceNative;
        const grossEur = grossNative * row.fxRateToEur;
        const feesEur = row.feesNative * row.fxRateToEur;
        db.insert(assetTransactions).values({
          id: ulid(), accountId, assetId,
          transactionType: row.kind, tradedAt: row.tradedAt,
          quantity: row.quantity, unitPrice: row.priceNative,
          tradeCurrency: row.currency, fxRateToEur: row.fxRateToEur,
          tradeGrossAmount: grossNative, tradeGrossAmountEur: grossEur,
          cashImpactEur: row.kind === "buy" ? -(grossEur + feesEur) : (grossEur - feesEur),
          feesAmount: row.feesNative, feesAmountEur: feesEur,
          netAmountEur: row.kind === "buy" ? -(grossEur + feesEur) : (grossEur - feesEur),
          isListed: true, source: "degiro-statement", rowFingerprint: row.rowFingerprint,
        }).run();
      } else if (row.kind === "dividend") {
        db.insert(assetTransactions).values({
          id: ulid(), accountId, assetId,
          transactionType: "dividend", tradedAt: row.tradedAt,
          quantity: 0, unitPrice: 0,
          tradeCurrency: row.currency, fxRateToEur: row.fxRateToEur,
          tradeGrossAmount: row.grossNative, tradeGrossAmountEur: row.grossEur,
          cashImpactEur: row.grossEur - row.withholdingOrigenEur - row.withholdingDestinoEur,
          feesAmount: 0, feesAmountEur: 0,
          netAmountEur: row.grossEur - row.withholdingOrigenEur - row.withholdingDestinoEur,
          dividendGross: row.grossNative, dividendNet: row.grossNative - row.withholdingOrigenNative,
          withholdingTax: row.withholdingOrigenEur, withholdingTaxDestination: row.withholdingDestinoEur,
          sourceCountry: row.sourceCountry,
          isListed: true, source: "degiro-statement", rowFingerprint: row.rowFingerprint,
        }).run();
      }
    }

    // Recompute lots for every asset.
    db.transaction((tx) => {
      for (const id of assetIdByIsin.values()) recomputeLotsForAsset(tx, id);
    });

    const report2025 = buildTaxReport(db, 2025);
    const report2026 = buildTaxReport(db, 2026);

    // Fixture has no sells; realized gains should be 0.
    expect(report2025.sales).toHaveLength(0);
    expect(report2025.totals.netComputableEur).toBe(0);

    // 2 UNH dividends in 2025 per fixture.
    expect(report2025.dividends.length).toBeGreaterThanOrEqual(2);
    for (const d of report2025.dividends) {
      expect(d.sourceCountry).toBe("US");
      expect(d.withholdingOrigenEur).toBeGreaterThan(0.8);
      expect(d.withholdingOrigenEur).toBeLessThan(1.0);
    }

    // 1 UNH dividend in 2026.
    expect(report2026.dividends.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run and fix**

Run: `pnpm test degiro-statement-e2e`
Expected: PASS. If dividend counts diverge, re-read the fixture and adjust expectations to the actual count — the fixture is canonical.

- [ ] **Step 3: Commit**

```bash
git add src/lib/imports/__tests__/degiro-statement-e2e.test.ts
git commit -m "test(imports): end-to-end fixture — statement.csv → buildTaxReport"
```

---

## Task 21: Final verification

- [ ] **Step 1: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 2: Verify Definition of Done items**

From CLAUDE.md:
- New DB columns have generated migrations under `drizzle/` ✓ (Tasks 1, 2)
- New env vars: none in this plan ✓
- Touched UI verified in dark + light: re-import button only — verify at `/accounts/<id>` in both modes
- Mutations write audit events and call `revalidatePath` ✓ (Task 18)
- New monetary renders via `<SensitiveValue>`: none added in this plan ✓

- [ ] **Step 3: Run fresh-DB smoke**

Run:
```bash
rm -rf data/*.db
pnpm db:migrate
pnpm dev
```
Navigate: `/accounts/new` → create a DEGIRO broker account → `/imports/new` → select DEGIRO Account Statement → upload `statement.csv` → confirm import → visit `/taxes` → year picker shows 2025 and 2026 → dividends visible with EUR amounts.

- [ ] **Step 4: Commit final verification note (no code)**

If any doc updates were needed during verification, commit them. Otherwise this is the handoff point to Plan 2.

---

## Self-review summary

Spec coverage against `docs/superpowers/specs/2026-04-19-spanish-tax-reporting-design.md`:

- §2.1 column additions → Task 1 ✓
- §2.2 new tables → Task 2 ✓
- §3.1 `recomputeLotsForAsset` → Task 6 ✓
- §3.2 `washSale.ts` → Task 7 ✓
- §3.3 `buildTaxReport` (engine + shim) → Task 8 ✓
- §5.1 DEGIRO statement parser → Tasks 14–17 ✓
- §6 Actions: `createTransaction` / `confirmImport` / `deleteTransaction` hooks → Tasks 9, 10 ✓
- §6 `reimportAccount` → Tasks 18, 19 ✓
- §9 Backfill → Tasks 12, 13 ✓
- §11 Acceptance: fresh-DB + statement.csv produces dividends → Task 20, 21 ✓

Out of scope for this plan (deferred to Plan 2): `/taxes/[year]` UI rework, `sealYear`/`unsealYear`, drift banner, casillas CSV / detail CSV / PDF upgrade / m720 diff, dividend form, swap modal, 720 diff engine.
