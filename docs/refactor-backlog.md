# Refactor Backlog

Work deferred from the 2026-04-23 consolidation pass (commit `4a2432a`).
Everything here is **nice-to-have** — the app works without it — but each
item removes a concrete source of drift or future bugs.

---

## 1. `withServerAction` wrapper

**What it is.** A higher-order helper that collapses the boilerplate every
Server Action repeats today:

1. Zod schema `.safeParse(input)` → return `{ok:false, code:"validation", fieldErrors}` on fail
2. Open `db.transaction(tx => …)` with business-logic errors thrown as `Error`
3. Insert an `audit_events` row (`entityType`, `action`, `previousJson`, `nextJson`, `contextJson: { actor: ACTOR }`)
4. `revalidate*()` outside the tx
5. Catch thrown errors and map to `{ok:false, error: {code, message}}`

Target signature (rough sketch):

```ts
// src/actions/_with-action.ts
export async function withServerAction<Input, Schema extends z.ZodTypeAny, T>({
  input,
  schema,
  db,
  handler,
  revalidate,
  entityType,
  action,
}: {
  input: unknown;
  schema: Schema;
  db: DB;
  handler: (tx: Tx, data: z.output<Schema>) => T | Promise<T>;
  revalidate: (data: z.output<Schema>, result: T) => void;
  entityType: string;
  action: string;
}): Promise<ActionResult<T>>;
```

**Why not today.** Touches 20+ action files. Each action's specific audit
context shape (e.g. `sealYear` logs year + seals; `confirmImport` logs
fingerprint list) means `contextJson` can't be one-size-fits-all. Likely
needs an optional `auditContext` callback argument and careful migration
per action to not regress error messages.

**Blast radius.** Every `src/actions/*.ts` file and every existing action
test. Plan to migrate 2-3 actions first and review before fanning out.

**Estimated savings.** ~400 LoC of boilerplate; eliminates the class of
bug where an action forgets to write an audit event or revalidates wrong
paths.

---

## 2. Unify `confirmImport.resolveFx` with `lib/fx.ts::resolveFxRate`

**Current state.**

- `src/actions/confirmImport.ts:85` defines a **sync** `resolveFx(tx, ccy, isoDate)`
  that reads `fx_rates` from the open tx and returns a raw number.
- `src/lib/fx.ts:resolveFxRate` is an **async** function that takes an
  injected `FxLookup`, returns a structured `{rate, source, stale?}`, and
  is used by the price-sync code.

Both do "look up a rate for a currency on a date, walk back to the latest
available if missing, fail loudly if nothing found." But they diverge in
shape: one is sync + tx-scoped + raw number; the other is async +
DB-agnostic + structured.

**What to do.** Convert the `insertTrade` / `insertDividend` /
`insertCashMovement` paths in `confirmImport` to async so they can call
`resolveFxRate` with a tx-backed `FxLookup`. Delete the local `resolveFx`.
Single place to change FX resolution policy (currently a change in one
drifts vs the other).

**Why not today.** The conversion requires awaiting inside a
`db.transaction((tx) => {…})` callback, and better-sqlite3's transaction
callback is sync. The whole tx body would need to either use the async
sqlite adapter or precompute all FX lookups before opening the tx.
Precomputing is doable but pushes complexity into a prep phase — bigger
surgery than it looks.

**Estimated savings.** Removes one duplicated helper + centralises the
"walk back to latest rate" policy. Low LoC, high invariant value.

---

## 3. `setManualPrice` revalidation helper

**Current state.** `src/actions/setManualPrice.ts:185-188` revalidates
`/assets`, `/overview`, `/positions`, `/audit` inline. Nearly matches
`revalidateAssetMetadata()` but adds `/positions`.

**What to do.** Either extend `revalidateAssetMetadata` with an optional
`{ positions?: boolean }` flag, or add a new `revalidateManualPrice()`
helper. Trivial.

**Why not today.** One-off; not worth the micro-change in a big diff.
Grouped here so it gets picked up next pass.

---

## 4. Potential follow-ups noticed during audit (not committed to yet)

- **Validation error shape** — some actions return flat
  `{code:"validation", message}`; others include `fieldErrors`. Standardise
  via the wrapper from #1.
- **Audit context typing** — currently `contextJson` is free-form
  `JSON.stringify(obj)`. Could define `AuditContext` union types per
  `entity_type` so the audit page can render them structurally.
- **Deprecation warnings** — `z.number()` usage in `actions/accounts.ts:29`
  is flagged by the latest Zod. Harmless but noisy; update the schema to
  the new API.
- **Drizzle `await` noise** — TS emits `80007` ("await has no effect")
  on every `.all()` / `.get()` because drizzle's builder chain returns
  a value eagerly. Known quirk; not actionable without upstream change.

---

## Priority order (when you come back to this)

1. **#3** — 2 minutes, zero risk, ticks a box.
2. **#1** — biggest payoff but needs a couple of hours of careful work.
3. **#2** — worth doing once #1 is in (the wrapper naturally accommodates
   async handlers).
4. **#4** — ongoing polish, fold into whatever task happens to touch those
   files next.
