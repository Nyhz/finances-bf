# Spanish Tax Reporting — Design Spec

**Date:** 2026-04-19
**Author:** Commander + Claude (brainstorming skill)
**Status:** Approved design, awaiting implementation plan
**Scope:** Make the Finances Panel produce perfect, auditable, Hacienda-grade tax data for a Spanish resident personal investor — including IRPF (Modelo 100), Modelo 720, Modelo 721, Modelo D-6.

---

## 1. Goals and non-goals

### Goals
- Every realized sale is traceable to the exact buy lots it consumed (FIFO, per homogeneous asset, globally across accounts).
- Every dividend carries gross / retención origen / retención destino / source country, with EUR-equivalents derived from the broker's actual FX rates when available.
- Wash-sale rule (regla de los 2 meses for listed securities and homogeneous crypto, 1 año for unlisted) is computed automatically, disallowed losses are deferred into the cost basis of the absorbing lot, and both the raw and adjusted numbers are surfaced.
- Crypto↔crypto swaps are recorded as two linked transactions with identical EUR value — matching Hacienda's "disposal + acquisition at market value" model.
- A year's tax computation can be **sealed** into a snapshot once filed. Later edits produce a drift indicator, not silent mutation of history.
- Exports: per-casilla CSV (for Renta Web paste), raw detail CSV (for the AEAT comprobación dossier), narrative PDF, and Modelo 720/721 diff report.
- The DEGIRO Account Statement CSV (`statement.csv`, bilingual EN/ES) imports cleanly with dividends mapped correctly.

### Non-goals
- Corporate actions (splits, spinoffs, mergers, dividend-in-shares, hard forks) — add per-event if they happen, not as infrastructure now.
- Staking rewards, airdrops, bond coupon accrual — out of scope.
- Tracking cash balances on broker / crypto_exchange / wallet accounts — positions and tax events only. Buys don't need to be "funded"; they just happen.
- Interest as a taxable event — Spanish bank interest is pre-declared by the bank via Modelo 196 and pre-filled in Renta Web. We record it for net-worth bookkeeping only.
- Any form of auth, multi-user, or sync — single-user LAN app, per SPEC §11.

---

## 2. Data model

All additive. No existing migration is edited. New migration number TBD at implementation time.

### 2.1 Changes to existing tables

**`asset_transactions`:**
- `transaction_type` gains `"dividend"` as a valid value alongside `"buy"` / `"sell"`.
- `source_country` (text, nullable) — ISO-3166 alpha-2. Populated on `dividend` rows (for DDI) and optionally on sells (for the D-6 dossier).
- `is_listed` (boolean, default true) — drives wash-sale window (60 days vs 365 days). Auto-set from asset metadata on import; manual override in the asset form.
- `withholding_tax_destination` (real, nullable) — Spanish 19% retención destino when the broker withholds it (EUR). The existing `withholding_tax` column becomes "origen".

**`accounts`:**
- `country_code` (text, nullable) — ISO-3166 alpha-2. Required for 720/721/D-6 grouping.
- New allowed values for `account_type`: `bank`, `savings`, `broker`, `crypto_exchange`, `wallet`. Existing values migrate: whatever's in use today maps 1:1.
- Cash-balance tracking: `currentCashBalanceEur` is maintained only where `account_type ∈ {bank, savings}`. For broker / crypto_exchange / wallet, the column stays at 0 and is never updated.

**`assets`:**
- `asset_class_tax` (text, nullable with migration backfill) — enum: `listed_security`, `unlisted_security`, `fund`, `etf`, `crypto`, `bond`, `other`. Drives Modelo 100 casilla routing and informational-model applicability.

### 2.2 New tables

**`tax_lots`** — one row per buy leg, the persisted FIFO ledger.

| column | type | notes |
|---|---|---|
| `id` | text | ULID |
| `asset_id` | text, FK `assets.id` | |
| `account_id` | text, FK `accounts.id` | |
| `origin_transaction_id` | text, FK `asset_transactions.id`, unique | the `buy` row that created the lot |
| `acquired_at` | integer | UTC ms, copied from `tradedAt` |
| `original_qty` | real | |
| `remaining_qty` | real | |
| `unit_cost_eur` | real | post-fee EUR cost per unit at creation |
| `deferred_loss_added_eur` | real, default 0 | bumped when a wash-sale absorbs a disallowed loss |
| `created_at` | integer | |

Indexes: `(asset_id, acquired_at)`, unique on `origin_transaction_id`.

**`tax_lot_consumptions`** — one row per FIFO match between a sell and the lot(s) it consumed.

| column | type | notes |
|---|---|---|
| `id` | text | ULID |
| `sale_transaction_id` | text, FK `asset_transactions.id` | |
| `lot_id` | text, FK `tax_lots.id` | |
| `qty_consumed` | real | |
| `cost_basis_eur` | real | qty_consumed × (lot.unit_cost_eur + lot.deferred_loss_added_eur prorated) |
| `created_at` | integer | |

Composite unique `(sale_transaction_id, lot_id)`. Index on `sale_transaction_id`.

**`tax_wash_sale_adjustments`** — one row per disallowed loss event.

| column | type | notes |
|---|---|---|
| `id` | text | ULID |
| `sale_transaction_id` | text, FK `asset_transactions.id` | the sale that generated the loss |
| `absorbing_lot_id` | text, FK `tax_lots.id` | the lot whose cost basis was bumped |
| `disallowed_loss_eur` | real | positive number — EUR of loss moved from "computable" to "deferred" |
| `window_days` | integer | 60 or 365 |
| `created_at` | integer | |

The same EUR amount is added to `tax_lots.deferred_loss_added_eur` on the absorbing lot.

**`tax_year_snapshots`** — sealed record of a filed year.

| column | type | notes |
|---|---|---|
| `id` | text | ULID |
| `year` | integer, unique | |
| `sealed_at` | integer | UTC ms |
| `payload_json` | text | the full `buildTaxReport(year)` result at seal time |
| `rendered_pdf_path` | text, nullable | local path to the PDF snapshot, under `data/snapshots/` |
| `rendered_csv_paths` | text, nullable | JSON: `{casillas, detail, m720Diff}` local paths |
| `notes` | text, nullable | |

Once a row exists for a year, that year is read-only from the UI's perspective. Edits to trades in a sealed year still succeed (Commander can always force a correction), but each such edit writes an `audit_events` row tagged `post-seal-drift` and the `/taxes/[year]` page shows a persistent drift banner with a diff against the sealed payload.

---

## 3. Engine

New folder `src/server/tax/` splits today's fat `src/server/taxes.ts` into focused units.

### 3.1 `lots.ts`

Exports `recomputeLotsForAsset(assetId, tx): void`.

Invoked from **inside the transaction** of every Server Action that inserts / edits / deletes an `asset_transactions` row for that asset. Logic:

1. Delete all `tax_lots`, `tax_lot_consumptions`, `tax_wash_sale_adjustments` for the asset.
2. Load every `asset_transactions` row for the asset, ordered by `(tradedAt ASC, id ASC)`.
3. Walk in order, maintaining a FIFO queue of lots (globally across accounts — per Commander, no per-account segregation).
4. For `buy`: create a `tax_lots` row with `unit_cost_eur = (tradeGrossAmountEur + feesAmountEur) / quantity`.
5. For `sell`: consume lots from queue head, writing a `tax_lot_consumptions` row per lot touched. Then invoke `washSale.checkSaleAtLoss(...)` if the sale closed at a net loss.
6. For `dividend`: no lot mutation — dividends don't change holdings.

FIFO is deterministic and idempotent. Running `recomputeLotsForAsset` twice in a row produces identical rows.

### 3.2 `washSale.ts`

Exports `checkSaleAtLoss(saleTxn, lotsAtTime, tx): void`.

The sale is at a loss if `proceedsEur − costBasisEur − feesEur < 0`. When that holds:

1. Determine window: `asset_class_tax = unlisted_security` → 365 days; else → 60 days.
2. Scan acquisitions of the same asset (any `buy` transaction, any account, any `origin_transaction_id` among current lots) within `[tradedAt − window, tradedAt + window]`.
3. Aggregate absorbing qty = min(sold_qty, acquired_qty_in_window).
4. `disallowed_loss_eur = loss × (absorbing_qty / sold_qty)`.
5. Distribute the disallowed loss proportionally across the absorbing lots by `remaining_qty`. For each, write a `tax_wash_sale_adjustments` row and increment `tax_lots.deferred_loss_added_eur`.
6. The sale's "computable loss" = raw loss + disallowed_loss_eur (disallowed reduces the loss). Raw loss is preserved in `tax_lot_consumptions.cost_basis_eur`; the adjustment rows carry the delta.

Edge cases:
- If the absorbing acquisition is already itself sold at the time of wash-sale check, the law allows the deferred loss to "pass through" to later lots of the same asset. Implementation: reapply the rule recursively, cap at 3 levels (pathological), otherwise expire the deferral with a warning audit event.
- If `absorbing_qty > sold_qty`, the excess acquisition is untouched — deferral applies only to matching qty.

### 3.3 `report.ts`

Exports `buildTaxReport(year): TaxReport`.

Composes from DB reads (no recompute — lots are already persisted):

- **Ganancias patrimoniales** — all `asset_transactions` with `transaction_type='sell'` in `[year, year+1)`, joined with their `tax_lot_consumptions` and any `tax_wash_sale_adjustments`. Each row carries: raw gain/loss, non-computable amount, computable gain/loss, FIFO breakdown, asset class for casilla routing.
- **Rendimientos del capital mobiliario** — all `asset_transactions` with `transaction_type='dividend'` in the year. Each row: gross native + EUR, retención origen EUR, retención destino EUR, net EUR, source country, estimated DDI credit (capped at Spain's bilateral treaty rate per country).
- **Interest (informational)** — sum of `accountCashMovements` with `movement_type='interest'` in the year, displayed but not counted toward tax totals.
- **Year-end balances** — per `(accountId, assetId)` as of `year+1`. For cash accounts (bank/savings), includes cash balance. For broker/crypto/wallet, positions only.
- **Modelo 720/721/D-6 status** — delegated to `m720.ts`.

Return shape is serializable JSON (becomes the `payload_json` on seal).

### 3.4 `seals.ts`

- `sealYear(year): Promise<TaxYearSnapshot>` — renders PDF + CSVs, writes them to `data/snapshots/<year>/`, inserts `tax_year_snapshots` row atomically, writes audit event. Fails if already sealed.
- `unsealYear(year): Promise<void>` — deletes the snapshot, audit event. UI guards with `ConfirmModal`.
- `computeDriftSinceSeal(year): DriftReport | null` — rebuilds the report live and diffs against `payload_json`. Returns `null` if identical, else a structured diff for the UI banner.

### 3.5 `m720.ts`

Exports `computeInformationalModelsStatus(year): { m720, m721, d6 }`.

For each, compute per-country / per-account-type blocks of year-end balance:

- **720** — foreign bank + broker balances (broker: positions valued at year-end spot × fxRateToEur, plus positions-only asset categories per AEAT blocks).
- **721** — foreign crypto balances, valued at year-end EUR spot.
- **D-6** — foreign listed securities, positions-only.

Refiling triggers (per AEAT FAQ):
- `new` — block's aggregate > €50,000 and never declared before.
- `delta_20k` — block was declared in a prior year, current year-end exceeds last-declared by > €20,000, OR drops below last-declared by > €20,000.
- `full_exit` — block was declared in a prior year, current year-end is 0.

Last-declared values come from the most recent sealed `tax_year_snapshots.payload_json` that contains a `m720.blocks[blockKey]` entry.

---

## 4. UI

### 4.1 `/taxes/[year]`

Dynamic route (not searchParam) so sealed years are bookmarkable and the URL is stable. `page.tsx` reads:

- Year picker + "Seal year" / "Unseal year" button + Export dropdown (PDF / Casillas CSV / Detail CSV / 720 Diff).
- **Drift banner** if sealed and drift detected.
- **KPI row** (7 cards): Realized gains, Realized losses (computable), Non-computable losses, Net computable, Dividends gross EUR, Retenciones total EUR, Interest (informational, muted styling).
- **Ganancias patrimoniales** `DataTable` — columns as in the current design, plus a new "Non-computable" column and an expandable row showing the consumed lots and any wash-sale adjustment with a link to the absorbing lot.
- **Rendimientos** `DataTable` — date, asset, country flag, gross, retención origen, retención destino, net, estimated DDI.
- **Year-end snapshot** — grouped by country, each block labelled with its refile status (`ok`, `new`, `delta_20k`, `full_exit`).
- All monetary values inside `<SensitiveValue>`, per CLAUDE.md.

### 4.2 `createSwap` modal

At `/transactions/new?kind=swap` or via a button on the transactions page. Fields:
- Account (defaults current)
- Outgoing asset + quantity
- Incoming asset
- Trade date/time (defaults now)
- EUR spot value — auto-resolved via `src/lib/pricing.ts` using the outgoing asset's EUR spot at `tradedAt`; editable.
- Fee: amount + currency + asset (fee-in-a-third-asset prompt). Settings-level dust threshold, default €1, below which no secondary disposal is recorded.

Writes both `sell outgoing` and `buy incoming` rows atomically, with matching `linkedTransactionId`. Both legs share `tradeGrossAmountEur`. One `recomputeLotsForAsset` call per affected asset.

### 4.3 Dividend form

At `/transactions/new?kind=dividend`. Fields:
- Account, asset, date
- Gross (native + currency)
- Retención origen (native + currency)
- Retención destino EUR (optional)
- Source country (pre-filled from ISIN prefix, editable)
- FX rate (pre-filled from `fx.ts` ECB rate for the date, editable to match broker's applied rate)
- Net EUR (read-only, computed)

Writes a `dividend` `asset_transactions` row. No accompanying cash movement is created on broker/crypto/wallet accounts per the no-cash-tracking rule.

### 4.4 `/accounts/[id]` — Re-import action

New button: **"Re-import account"**. Guarded `ConfirmModal`. On confirm:
1. Inside one DB transaction: delete `tax_wash_sale_adjustments`, `tax_lot_consumptions`, and `tax_lots` for the assets this account touches; then delete the account's `asset_transactions` and `accountCashMovements`. FK onDelete policies on the new tax tables are `cascade` to `asset_transactions.id`, so the pre-delete step is belt-and-braces for safety / deterministic recompute ordering.
2. Write `audit_events` row tagged `account-reimport` with previous counts.
3. Recompute lots for all assets the account touched (pre-collected asset ids).
4. `revalidatePath` every affected route.
5. Redirect to `/imports/new?accountId=id` for the user to upload a fresh CSV.

### 4.5 Broker/crypto account pages

Remove the cash-balance KPI for `account_type ∈ {broker, crypto_exchange, wallet}`. Replace with a "Positions only — cash not tracked" tag. The existing cash-impact columns stay visible on the trade rows for FX auditing but don't sum into a balance.

---

## 5. Importers

### 5.1 New: `src/lib/imports/degiro-statement.ts`

Parses the DEGIRO **Account Statement** export (distinct from the Transactions export already handled by `degiro.ts`). Header recognised (EN variant): `Date, Time, Value date, Product, ISIN, Description, FX, Change, (ccy), Balance, (ccy), Order Id`. Spanish variant recognised by matching localized headers.

Decimal format: European — `"1.924,05"` means 1924.05. Dates `DD-MM-YYYY`. The two unnamed columns after `Change` and `Balance` carry currency codes.

**Description dispatch table** (prefix match, case-insensitive, locale-aware):

| Description | Emitted row | Notes |
|---|---|---|
| `Compra N ...@P CCY (ISIN)` / `Venta ...` | `buy` / `sell` asset txn | Qty + price parsed from the string. Grouped by OrderId with fee + FX legs. |
| `Costes de transacción y/o externos de DEGIRO` (with OrderId) | Folded into the trade's `feesAmountEur` | |
| `ADR/GDR Pass-Through Fee` | `fee` cash movement tagged on the asset — **not persisted on broker accounts** per cash-tracking rule; only captured into audit log | |
| `Ingreso/Retirada Cambio de Divisa` (with OrderId) | FX legs of a trade — the `FX` column is the USD→EUR rate, used to snapshot the trade's `fxRateToEur` | Not persisted as a separate row. |
| `Ingreso/Retirada Cambio de Divisa` (without OrderId) | FX legs of a dividend auto-conversion — matched to a `Dividendo` on same ISIN within ±3 days | Used to resolve the dividend's EUR value. Not persisted separately. |
| `Dividendo` | `dividend` asset txn | Gross native amount from `Change`. EUR resolved from matched FX legs, else fallback to `src/lib/fx.ts`. |
| `Retención del dividendo` | `withholding_tax` on the matching dividend | Matched by ISIN + date within ±3 days. |
| `Impuesto sobre dividendo` | `withholding_tax_destination` on the matching dividend | |
| `flatex Deposit` | **Ignored on broker accounts** — consumed by parser only | |
| `Flatex Interest Income` | **Ignored on broker accounts** | Values are 0 in practice. |
| `Degiro Cash Sweep Transfer` + `Transferir ... flatexDEGIRO Bank` | **Ignored** — internal plumbing | |
| `Comisión de conectividad con el mercado YYYY (...)` | **Ignored on broker accounts** | |
| `Ingreso` (bare) | **Ignored on broker accounts** | |
| Anything else | `ImportParseError` with the full row | Surfaced in import preview for manual classification. |

**Dedup**: `row_fingerprint = sha1(date|time|valueDate|ISIN|description|change|changeCcy|balance)`. Re-importing the same statement is a no-op.

**Asset resolution**: ISIN → existing `assets` row. If none exists, parser emits a `newAsset` hint in the import preview (name from `Product` column, symbol/ticker null, `asset_class_tax` inferred from ISIN prefix: IE→etf default, US→listed_security, ES→listed_security, etc.) that the user confirms before the import commits.

**Fixture**: copy `/statement.csv` → `src/lib/imports/__fixtures__/degiro-statement.sample.csv` as the canonical test input. The parser's snapshot test asserts the full parse output against a reviewed expected tree. This is the file Commander will re-import after wiping the DEGIRO account.

### 5.2 Existing parsers — no change

`degiro.ts` (Transactions export), `binance.ts`, `cobas.ts` continue to work as today. The new parser is selected via a new `import_kind = 'degiro-statement'` option in the import wizard.

---

## 6. Actions surface

New Server Actions (all validated with Zod, audit-logged, `revalidatePath`'d):

- `createDividend(input)` — writes `dividend` asset txn.
- `createSwap(input)` — writes paired `buy` + `sell` rows atomically with matching `linkedTransactionId` and EUR parity.
- `sealYear(year)` / `unsealYear(year)`
- `reimportAccount(accountId)` — the destructive reset flow from §4.4

Existing actions (`createTransaction`, `createCashMovement`, `confirmImport`, `deleteTransaction`, etc.) updated to:
1. Skip persisting `accountCashMovements` when the target account is broker / crypto_exchange / wallet.
2. Call `recomputeLotsForAsset(assetId)` inside the transaction for any asset-level change.

---

## 7. Exports

All under `src/app/api/exports/tax/`. Each reads from the sealed snapshot if `tax_year_snapshots` row exists for the year, else from live data, and embeds a provenance header.

- `pdf?year=YYYY` — rewritten narrative PDF (upgrade of `src/lib/pdf/tax-report.ts`). Includes per-casilla summary table, per-sale detail with lot breakdown, dividends with DDI estimates, 720/721/D-6 status.
- `casillas.csv?year=YYYY` — one row per Modelo 100 casilla that applies, with aggregate EUR value. UTF-8 BOM + pipe separator for Renta Web paste tolerance. Casillas covered:
  - 0326–0343 (ganancias y pérdidas patrimoniales derivadas de transmisión)
  - 0027–0032 (rendimientos del capital mobiliario: dividendos, intereses)
  - 0588 (deducción por doble imposición internacional)
  - Others as needed per asset-class routing.
- `detail.csv?year=YYYY` — flat per-row dump: every realized sale (with FIFO lot breakdown), every dividend (with retenciones), every wash-sale adjustment. For the comprobación dossier.
- `m720-diff?year=YYYY` — JSON + CSV of the 720/721/D-6 block diffs vs last declared, with refile flags.

---

## 8. Testing

Vitest unit tests per SPEC §10. Key suites:

- `src/server/tax/__tests__/lots.test.ts` — simple buy/sell, partial sell, multi-account same-asset FIFO, crypto swap (paired txns), dividend doesn't touch lots, re-running recompute is idempotent.
- `src/server/tax/__tests__/washSale.test.ts` — buy-after-loss within 60 days (listed), unlisted 365-day window, partial absorption, recursive deferral, deferral expiry.
- `src/server/tax/__tests__/report.test.ts` — fixture-driven 2025 scenario: buys + dividends (with retenciones, multiple countries) + sell-at-loss + rebuy-within-45-days + crypto swap + year-end crossing €50k. Snapshot all exports.
- `src/server/tax/__tests__/m720.test.ts` — new/delta/exit trigger detection.
- `src/lib/imports/__tests__/degiro-statement.test.ts` — parse the committed `statement.csv` fixture, snapshot the parsed tree. Assert dividend FX matching, retención attachment, internal-plumbing suppression.
- `src/actions/__tests__/reimportAccount.test.ts` — the destructive reset path.

Pricing and FX are stubbed via `src/lib/pricing.ts` / `src/lib/fx.ts` test doubles; no network calls in the suite (per CLAUDE.md).

---

## 9. Migration / rollout

1. Migration adds new columns and tables (additive).
2. Backfill: populate `tax_lots` and `tax_lot_consumptions` by running `recomputeLotsForAsset` for every distinct `assetId` in `asset_transactions`. This is deterministic and idempotent — safe to re-run.
3. Backfill `assets.asset_class_tax` with a best-effort heuristic (crypto by `assetType='crypto'`, ETF by ticker pattern, else `listed_security`). Surface unknowns in a "classify assets" UI for manual fix.
4. Backfill `accounts.country_code` — manual UI prompt before any 720 status is computed.
5. No backfill for `tax_wash_sale_adjustments` — they emerge naturally from the lot recompute.
6. Commander runs: **(a)** deploy → **(b)** reclassify assets / fill account countries → **(c)** re-import DEGIRO statement to pick up dividends.

---

## 10. Open questions

None at design time. Open items surface during implementation:
- ISIN → country map coverage (hardcode top 50, allow override).
- DDI treaty rate table (hardcode top 20 countries, default to 15% US treaty rate for unknowns).
- PDF template styling — carried from existing tax-report PDF with additions for new sections.

---

## 11. Acceptance criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.
- Importing `statement.csv` against a fresh DEGIRO account yields: correct trades with fees folded in, correct dividends with retención origen, source country `US` for US91324P1021, EUR values matching the broker's FX conversions within rounding.
- A 2025 fixture scenario with a sell-at-loss followed by a rebuy 30 days later reports `disallowed_loss_eur > 0` and reduces the year's computable loss accordingly.
- Sealing a year produces a snapshot row. Editing a transaction in that year produces a drift indicator on the taxes page.
- Broker account pages show no cash balance KPI. Buys in broker accounts don't depend on or change any cash balance.
- All monetary renders wrapped in `<SensitiveValue>`.
- `casillas.csv` pastes cleanly into Renta Web for a test year.
