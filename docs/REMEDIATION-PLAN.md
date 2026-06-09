# Remediation Plan — Audit 2026-06-09

> **STATUS (2026-06-09): Phases 0–7 EXECUTED.** All gates green (typecheck, lint
> incl. migration guard + provenance wall, 246 tests, build). Deferred items:
> integer-cents storage (decision: defer), overview.ts chart-path batching and
> sparkline trims (7.2-partial/7.6 — display-only, revisit if charts feel slow),
> upsert-on-resync (decision: keep documented skip semantics, SPEC §6).
> Migrations shipped: 0007 (fx_source), 0008 (valuation_basis).

Companion to `docs/AUDIT-2026-06-09.md`. Finding IDs (T*, R*, P*) and test IDs (R-1…R-14) refer to that report.

Execution discipline: one phase per mission, in order. Each mission ends with the full Definition of
Done from CLAUDE.md (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, dark+light check when
UI is touched, generated migration for any new column, audit events + `revalidatePath` on mutations).
Phases are sized to be individually shippable — the app must stay fully working after every phase.

Ordering rationale:
- **Guard tests come first** (Phase 0) so every later fix lands against an executable invariant.
- **Data-writing paths are fixed before the branded-types refactor** (Phase 6) — otherwise the type
  work would be done twice.
- **Report-shape changes are batched** (Phases 2–3) because `TaxReport` is frozen inside sealed
  snapshots; every shape change must keep old `payloadJson` parseable (new fields optional, lenient
  parse). One snapshot-compat test covers all of them.

---

## Phase 0 — Guardrails (no behaviour change)

> Goal: make the invariant executable before touching anything.

**0.1 Market-independence regression test (R-1).**
New `src/server/tax/__tests__/market-independence.test.ts`: seed accounts/assets/transactions
(buys, sells, dividends, a permuta pair), `buildTaxReport`, then delete every row from
`price_history` + `asset_valuations` + (copy of) `fx_rates`, rebuild report → assert `totals.*`,
`sales[]`, `dividends[]` deep-equal. `yearEndBalances` asserted at current (€0) behaviour with a
`// TODO Phase 2 flips this to unvalued` marker.
- Files: new test only.

**0.2 Migration data-guard script (R4 / R-13).**
New `scripts/check-migrations.mjs`: fails if any `drizzle/*.sql` not in an allow-list contains
`UPDATE`/`DELETE` touching `asset_transactions`, `account_cash_movements`, or `accounts`.
Allow-list seeded with shipped `0002`/`0003`. Wire into `pnpm lint` (or a `pnpm check` script).
- Files: `scripts/check-migrations.mjs`, `package.json`.

**0.3 Lot-integrity assertion test (R-5).**
Property-style test in `src/server/tax/__tests__/lots.test.ts` (extend): random buy/sell sequences →
Σ`qtyConsumed` per sale == sale qty; Σ(consumed cost) + Σ(remaining lot cost) == Σ(buy gross+fees) ± €0.01.
- Files: extend existing test.

Exit: new tests green against current code (they document today's clean paths).

---

## Phase 1 — Tax-critical input correctness (T1, T2, T3, R6, R10)

> Goal: every EUR amount stamped onto a transaction is either explicit or traceably FX-resolved; no silent defaults.

**1.1 [T1 — CRITICAL] Non-EUR dividends require an FX rate.**
- `src/actions/createDividend.schema.ts`: `.refine(d => d.currency === "EUR" || d.fxRateToEur != null, …)`.
- `src/actions/createDividend.ts:33`: replace `?? 1` — when `currency !== "EUR"` and no explicit
  rate, resolve from `fx_rates` via the shared resolver (1.2); error `ok:false` if absent. Record
  resolved rate + source in the audit `contextJson`.
- `src/components/features/transactions/CreateDividendModal.tsx`: gate submit on
  `needsFx → fxRateToEur` filled OR show "will resolve from stored rates" hint; surface the
  server validation error.
- Tests: R-2 (USD dividend, no rate, empty fx_rates → validation error; with fx_rates row → resolved
  + source recorded). Update `createDividend.test.ts`.

**1.2 [T2 — HIGH] Single FX resolver with staleness, used everywhere.**
- New `src/actions/_fx.ts` (server-side): `resolveFxForDate(tx, currency, isoDate, explicitRate?)`
  → `{ rate, source: "unit"|"explicit"|"historical"|"latest", stale: boolean }`, implemented as a
  thin synchronous adapter over the same precedence as `lib/fx.ts` (or refactor `lib/fx.ts` to accept
  a sync lookup — pick whichever keeps `lib/fx.ts` the single precedence definition per CLAUDE.md).
- Migration: add nullable `fx_source` text column to `asset_transactions` and
  `account_cash_movements` (`pnpm db:generate`; never edit past migrations).
- Replace inline lookups: `createTransaction.ts:55-75`, `confirmImport.ts resolveFx:86-104`,
  `createDividend.ts` (from 1.1), `setManualPrice.ts:81-96` (already tracks source — converge on the
  shared resolver). Persist `fx_source`; include `{fxSource, stale}` in audit `contextJson`.
- UI: stale badge in transaction tables/import preview — small `Badge` next to the EUR amount when
  `fx_source = 'latest'` (both themes).
- Tests: R-3 (rate exists only for D-7 → row stamped `fx_source='latest'`); historical-rate case
  stamps `'historical'`; explicit override stamps `'explicit'`.

**1.3 [T3 — HIGH] Import FX plan covers all row kinds.**
- `src/actions/confirmImport.ts:49-60` `gatherFxPlan`: iterate dividends + cash movements too
  (skip rows carrying `fxRateToEurOverride`).
- Tests: fixture CSV with a USD dividend and zero USD trades → import succeeds with fresh rates
  fetched; with FX fetch stubbed to fail → whole import aborts, zero rows written (extends R-6/R-14).

**1.4 [R10] Real date validation on all entry schemas.**
- Shared `isoDateSchema` in `src/actions/_shared.ts` (or a new `_schemas.ts`): regex + `.refine`
  round-trip (`toIsoDate(new Date(d)) === d`) + `d <= today` (entry forms only — imports keep
  historical freedom but still round-trip).
- Apply to `createTransaction.schema.ts`, `createDividend.schema.ts`, `createCashMovement.schema.ts`,
  `createSwap.schema.ts`, `setManualPrice.schema.ts`.
- Tests: `2025-13-45`, `2025-02-30`, future date → rejected.

**1.5 [R6] Offline path for new currencies.**
- Verify `CreateTransactionModal` exposes the optional `fxRateToEur` field; add if missing.
- Map the `No FX rate available…` error to a friendly field error pointing at manual FX entry.
- Test: action returns `code:"validation"`-style error (not raw `db`) for missing FX.

Exit: Phase 0 tests still green; R-2/R-3 green; `fx_source` migration applied.

---

## Phase 2 — M720 / year-end integrity (T4, T5, T10, R9)

> Goal: year-end declarations can no longer silently understate, go stale, or misattribute.

**2.1 [T4] Unvalued balances are flagged, never €0.**
- `src/server/tax/report.ts:248-272`: `YearEndBalance` gains `valueEur: number | null`,
  `valuationDate: string | null`, `priceSource: string | null`, `unvalued: boolean`.
- `aggregateBlocksFromBalances` (`m720Aggregate.ts`): blocks gain `hasUnvalued: boolean`; unvalued
  positions excluded from the sum but counted. `m720.ts` annotation marks affected blocks.
- UI: `YearEndCard.tsx` renders an explicit "UNVALUED — declared thresholds unreliable" warning row
  (both themes). Exports (`tax-detail.ts`, `tax-m720-diff.ts`, PDF) print `UNVALUED` not `0`.
- `sealYear.ts`: refuse to seal when any foreign block `hasUnvalued`, unless input carries
  `acknowledgeUnvalued: true` (ConfirmModal in `SealYearButton.tsx`).
- Snapshot compat: lenient parse — old snapshots without the new fields still load (test with a
  frozen fixture `payloadJson`).

**2.2 [T5] Staleness bound on year-end valuations.**
- Same report block: compute `staleDays = yearEnd − valuationDate`; `stale: boolean` (> 10 days).
  Render amber flag in `YearEndCard` + exports.

**2.3 [T10] Per-account year-end quantities from transactions, not lot residue.**
- `report.ts:238-247`: replace residual-lot grouping with per-`(accountId, assetId)` signed quantity
  sums over `asset_transactions` up to year-end (lots remain the source for *cost*, which is global
  FIFO; custody location is transactional fact).
- Tests: two accounts, same asset, sell at account B → year-end quantities stay attributed to the
  holding account; M720 country blocks correct. Verify totals unchanged for single-account fixtures.

**2.4 [R9] Corrupted snapshots surface instead of vanishing.**
- `seals.ts:26-31`, `m720.ts:33-37`: on parse failure return/propagate `{corrupt: true}`;
  `taxes/[year]/page.tsx` shows a red banner ("sealed snapshot unreadable — showing live data");
  drift banner suppressed in that state.
- Test: garbage `payloadJson` → banner state, no throw (R-12 second half).

Exit: R-1 test updated — wiping market tables now flips `yearEndBalances` to `unvalued:true` rather
than 0; sealed-snapshot fixture from before Phase 2 still parses.

---

## Phase 3 — Report disclosure & precision (T6, T7, T9, T11, T12)

> Goal: nothing the report drops or derives is invisible; exports are numerically presentable.

**3.1 [T7] Dust-filter disclosure.**
- `report.ts`: collect excluded sells into `excludedSales: { count, proceedsEur, costBasisEur }` on
  `TaxReport` (optional field — snapshot compat). Render one summary line in `GainsTable`/PDF when
  count > 0. Test R-9.

**3.2 [T6] Mark market-valued permuta legs.**
- `binance.ts` mirror-leg rows: set a marker the insert path persists — simplest: extend
  `ParsedImportRow` trade with `valuationBasis: "market-fx"` and write it into
  `asset_transactions.notes` or a new nullable `valuation_basis` column (prefer the column; same
  migration batch as 1.2 if phases merge, else new migration).
- `tax-detail.ts` export + `GainsLotDetail.tsx`: show "valued at CoinGecko daily close" on flagged
  rows. Document in SPEC §6. Test R-11.

**3.3 [T9] Rounding at every aggregation/export boundary.**
- `report.ts:213-235` totals: `roundEur` each accumulated total once at the end.
- `tax-casillas.ts:24`: `r.valueEur.toFixed(2)`; `tax-detail.ts:55`: format money cells to 2dp
  (quantity keeps full precision); same audit of `tax-m720-diff.ts` and PDF.
- Test R-8 (property: 1,000 × €0.10 → `/^-?\d+\.\d{2}$/`).
- **Decision logged, deferred:** integer-cents storage migration — large, separate initiative;
  revisit after Phase 7. The boundary-rounding above removes the visible symptom.

**3.4 [T11] Bad buy rows fail loudly in lot replay.**
- `lots.ts:62`: `quantity <= 0` on a buy → throw (mirror of the oversell error at :110-114).
- Test: corrupted buy row → recompute throws, surrounding action returns `ok:false`, transaction
  rolls back.

**3.5 [T12] Stronger drift detection.**
- Seal payload gains `contentHash`: sha-256 over sorted `(transactionId, computableGainLossEur)` +
  `(transactionId, grossEur)` lists. `computeDriftSinceSeal` compares hash in addition to totals.
  Old snapshots without hash: totals-only comparison (compat).
- Test: compensating edit (delete one sale, add equal-net other) → drift detected via hash.

Exit: report shape final for this effort → re-freeze the snapshot-compat fixture.

---

## Phase 4 — External-call hardening (R1, R2, R5, R3+P3, R12)

> Goal: market-API failure modes are bounded: no hangs, no partial writes, no silent USD.

**4.1 [R1] Timeout + retry wrapper.**
- New `src/lib/pricing/_net.ts`: `withTimeout(promise, ms)` via `AbortSignal.timeout` /
  `Promise.race`, and `withRetry(fn, {attempts: 3, backoff})` for cron paths only.
- Apply in `yahoo.ts`, `coingecko.ts`, `fx-backfill.ts` (`yahoo.chart`). Import path
  (`confirmImport` FX prefetch) gets timeout but **no** retry (fails fast, atomic abort already
  correct).
- Tests: stub a never-resolving fetch → rejects within timeout; flaky-then-success → retried (cron).

**4.2 [R2] No silent USD.**
- `yahoo.ts:17`: missing `raw.currency` → throw. `fetchHistory`: stop hardcoding `"USD"` — take the
  currency from the quote/meta or drop the field if unused.
- `price-sync.ts`: when `quote.currency !== asset.currency`, skip the asset with an error entry in
  the sync summary (do not write the price).
- Tests: currency-mismatch fixture → no `price_history` row, summary error present.

**4.3 [R5] Zod-validate provider responses.**
- `coingecko.ts`: schemas for quote + market_chart shapes; `fx-backfill.ts` chart cast → schema.
  Garbage shape → clean thrown error naming the provider. Tests with malformed payload fixtures.

**4.4 [R3 + P3] Transactional writes + cron mutex.**
- `price-backfill.ts`: fetch bars first (async), then persist each asset's rows inside one
  `db.transaction()` (no `await` inside — restructure loops so DB work is synchronous).
- `price-sync.ts:231-308`: same — collect, then one transaction for price+valuation writes per run.
- Both cron routes (`sync-prices`, `backfill-prices`): module-level in-flight guard
  (`let running = false`) returning `409 already-running`. (Single-process LAN app — in-process
  mutex is sufficient.)
- Tests: simulate duplicate-date insert → counted as skipped, run completes; concurrent route
  invocation → second gets 409 (extend `cron-sync.test.ts`, R-14).

**4.5 [R12] Same-day re-sync semantics.**
- Decide: upsert (refresh today's close) instead of skip — matches `pricedAt` update in
  `setManualPrice`. Keep idempotency (one row per symbol/day). Document in SPEC §6.

Exit: R-14 e2e green (providers down → error summary, zero partial writes, tax flows unaffected).

---

## Phase 5 — Entry & import robustness (R7, R8, R11)

**5.1 [R7] Manual fingerprint collisions.**
- `createTransaction.ts` / `_fingerprint.ts`: for `source:"manual"`, append a per-day sequence
  (count existing identical fingerprints inside the tx and salt with `:n`). Catch the unique-index
  error and return `code:"duplicate"` with a human message; modal shows "looks like a duplicate —
  save anyway?" flow (second submit passes `allowDuplicate: true` → salted fingerprint).
- Test: same trade twice → first ok, second `duplicate`; with override → both persisted.

**5.2 [R8] Import parse errors persisted and acknowledged.**
- `previewImport.ts` already surfaces errors in preview (verify; fix if not).
- `confirmImport.ts`: write `parseResult.errors` (row index + message + raw row) into the import
  audit event `nextJson`; require `acknowledgeErrors: true` in the schema when `errors.length > 0`,
  else return `ok:false` listing them. `ImportWizard.tsx`: error list + checkbox.
- Test: CSV with 2 bad rows → confirm without ack fails; with ack commits and audit event contains
  both errors.

**5.3 [R11] Reimport keeps a recovery payload.**
- `reimportAccount.ts`: before deleting, serialize deleted `asset_transactions` +
  `account_cash_movements` into the audit event `previousJson` (capped; it's single-user SQLite).
- Test: reimport → audit row contains the prior transactions.

---

## Phase 6 — Compile-time provenance enforcement (T8, R-4)

> After Phases 1–3 so value flows are final.

**6.1 Branded money types.**
- New `src/lib/money-types.ts`:
  `TxEur`, `MarketEur` (branded numbers), constructors `txEur(n)`, `marketEur(n)` used only at the
  DB read boundary (`src/server/`), `unbrand()` for display/format layers.
- Type the hot surfaces: `TaxReport` fields = `TxEur` except `YearEndBalance.valueEur: MarketEur | null`;
  `recomputeLotsForAsset`, `washSale`, exports, PDF signatures.
- Do **not** brand the Drizzle schema itself (keeps `$inferSelect` clean); brand at the read helpers.

**6.2 Boundary lint.**
- ESLint `no-restricted-imports`: `src/server/tax/**` may not import `asset_valuations`,
  `price_history`, or `lib/pricing` — except an allow-listed `report-yearend` module (extract the
  year-end block from `report.ts` into `src/server/tax/yearEnd.ts` so the exception is one file).

**6.3 Type-leak test (R-4).**
- `src/lib/__tests__/money-types.test-d.ts` (or `@ts-expect-error` in a compiled test): assigning
  `MarketEur` where `TxEur` expected fails compilation.

Exit: `pnpm lint` enforces the import boundary; R-4 in CI.

---

## Phase 7 — Performance (P1, P2, P4, P5, P6, P7)

**7.1 [P1] Incremental valuation rebuild.**
- `server/valuations.ts`: accept `fromIso` (earliest affected trade date); delete + rebuild only
  rows ≥ `fromIso`; replace per-day trade rescan (`:110-117`) with a cursor (pattern already in
  `price-backfill.ts:251-258`). `mutations.ts` passes the mutated trade's date (or earliest of the
  batch for imports).
- Tests: equivalence test — incremental rebuild result == full rebuild result on random fixtures
  (reuse `valuations-rebuild.test.ts` e2e).

**7.2 [P2] Batch the N+1 read paths.**
- `positions.ts:34-54`, `assets.ts:30-58`, `overview.ts:128-142/288-307/513-529`: one
  window-function query each (`ROW_NUMBER() OVER (PARTITION BY assetId ORDER BY date DESC)`) via
  Drizzle `sql` fragments (query builder only — no raw SQL strings in app logic per CLAUDE.md;
  `sql` operator fragments are the sanctioned escape hatch — keep them in `src/server/`).
- `report.ts`: fetch all year consumptions/lots/assets/accounts in ≤4 queries, join in maps.
- Tests: existing server tests assert identical outputs.

**7.3 [P4] Index migration.**
- `pnpm db:generate` migration: index on `price_history(symbol)` (verify composite isn't already
  symbol-leading first), `asset_valuations(assetId, valuationDate)` if not covered.

**7.4 [P5] `getTaxYears` via aggregates.** — min/max (or distinct year extraction) instead of
full-table loads. Test: same output.

**7.5 [P6] `price-sync` FX map prefetch.** — one `fx_rates` read per currency per run.

**7.6 [P7] Optional, last:** trim sparkline payloads to ~120 points; audit retention noted as
"not now"; verify `lib/pdf/*` stays server-only (already true — keep a lint rule if cheap).

---

## Deferred / decisions for the Commander

1. **Integer-cents storage** (T9 full fix): real migration of every monetary column + all arithmetic.
   Recommend **defer** — boundary rounding (3.3) + branded types (6) remove the practical risk for a
   single-user EUR app. Revisit if drift ever shows in R-5/R-8 property tests.
2. **Permuta valuation source** (T6): keeping CoinGecko daily close (status quo, now disclosed) vs.
   deriving execution-time value where the CSV allows. Recommend status quo + disclosure.
3. **`reimportAccount` undo window** beyond audit payload (5.3): probably unnecessary.

## Suggested mission sizing

| Phase | Scope | Risk |
|---|---|---|
| 0 | tests + script only | none |
| 1 | 5 actions, 1 migration, 2 modals | low — heavily tested |
| 2 | report shape + seal + 1 page | medium — snapshot compat |
| 3 | report + exports + parser marker (+1 migration) | low |
| 4 | pricing clients + 2 cron routes | low |
| 5 | 3 actions + wizard | low |
| 6 | cross-cutting types + lint | medium — wide but mechanical |
| 7 | server reads + valuations (+1 migration) | medium — equivalence-tested |

Every phase: run R-1 and the lot-integrity property test before declaring done.
