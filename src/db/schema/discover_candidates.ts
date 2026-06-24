import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { createdAtCol, idCol } from "./_shared";

// Confirmed opportunities surfaced by the Discover agent. NOT FK'd to assets —
// these are market-wide tickers the user may not own; "Añadir a watchlist"
// materialises one into an `assets` row on demand. Each row pairs the agent's
// thesis with the deterministically VERIFIED metrics (only `confirmed` rows are
// stored; refuted/unverifiable proposals are dropped, counted in the run summary).
export const discoverCandidates = sqliteTable(
  "discover_candidates",
  {
    id: idCol(),
    runId: text("run_id").notNull(), // the advisor_runs id of the producing run
    symbol: text("symbol").notNull(), // Yahoo-usable ticker
    name: text("name").notNull(),
    criterion: text("criterion").notNull(),
    thesis: text("thesis").notNull(), // the agent's argument
    sourceUrl: text("source_url"),
    detail: text("detail").notNull(), // verified hard number, e.g. "−23% desde máx. 30d"
    // Verified metrics snapshot.
    price: real("price"),
    currency: text("currency"),
    dma200: real("dma200"),
    pctVsDma200: real("pct_vs_dma200"),
    drawdown30d: real("drawdown_30d"),
    momentum20d: real("momentum_20d"),
    pctBelow52wHigh: real("pct_below_52w_high"),
    sector: text("sector"),
    sectorStrength3m: real("sector_strength_3m"),
    ownReturn3m: real("own_return_3m"),
    status: text("status").notNull(), // "confirmed"
    discoveredAt: integer("discovered_at", { mode: "number" }).notNull(),
    createdAt: createdAtCol(),
  },
  (t) => ({
    runIdx: index("discover_candidates_run_idx").on(t.runId),
  }),
);

export type DiscoverCandidate = typeof discoverCandidates.$inferSelect;
export type NewDiscoverCandidate = typeof discoverCandidates.$inferInsert;
