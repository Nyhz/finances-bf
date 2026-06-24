import "server-only";
import { ulid } from "ulid";
import { db as defaultDb, type DB } from "../../db/client";
import { discoverCandidates } from "../../db/schema";
import { fetchAssetSector, fetchHistory, fetchQuote } from "../pricing";
import { withRetry } from "../pricing/_net";
import { recordAdvisorRun } from "../advisor/runs";
import { sendTelegram } from "../advisor/telegram";
import { runDiscover, type ConfirmedCandidate, type DiscoverResult, type RunAgent } from "./discover";
import type { VerifyClients } from "./verify";

// Orchestrates one Discover run: runs the agent + verification, REPLACES the
// stored candidate set with this run's confirmed opportunities, and records the
// run in advisor_runs (kind="discover") for telemetry. Reuses the Yahoo pricing
// layer (with retry) for verification; never writes price_history.

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function realClients(): VerifyClients {
  return {
    fetchHistory: (s, from, to) => withRetry(() => fetchHistory(s, from, to)),
    fetchQuote: (s) => withRetry(() => fetchQuote(s)),
    fetchAssetSector: (s) => withRetry(() => fetchAssetSector(s)),
  };
}

/** Replace the visible candidate set with this run's confirmed list. Returns the
 *  run id. Shared by the cron orchestrator and the streaming manual trigger. */
export function persistDiscover(
  db: DB,
  confirmed: ConfirmedCandidate[],
  startedAt: number,
): string {
  const runId = ulid();
  db.transaction((tx) => {
    tx.delete(discoverCandidates).run();
    for (const c of confirmed) {
      tx
        .insert(discoverCandidates)
        .values({
          id: ulid(),
          runId,
          symbol: c.symbol,
          name: c.name,
          criterion: c.criterion,
          thesis: c.thesis,
          sourceUrl: c.sourceUrl ?? null,
          detail: c.detail,
          price: c.metrics.price,
          currency: c.metrics.currency,
          dma200: c.metrics.dma200,
          pctVsDma200: c.metrics.pctVsDma200,
          drawdown30d: c.metrics.drawdown30d,
          momentum20d: c.metrics.momentum20d,
          pctBelow52wHigh: c.metrics.pctBelow52wHigh,
          sector: c.metrics.sector,
          sectorStrength3m: c.metrics.sectorStrength3m,
          ownReturn3m: c.metrics.ownReturn3m,
          status: "confirmed",
          discoveredAt: startedAt,
        })
        .run();
    }
  });
  return runId;
}

export type RunDiscoverScanResult =
  | { ok: true; skipped?: false; result: DiscoverResult }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function runDiscoverScan(opts: {
  slot?: string | null;
  model?: string;
  db?: DB;
  now?: Date;
  clients?: VerifyClients;
  runAgent?: RunAgent;
}): Promise<RunDiscoverScanResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const startedAt = now.getTime();
  const model = opts.model ?? process.env.DISCOVER_SCAN_MODEL ?? DEFAULT_MODEL;

  if (process.env.DISCOVER_ENABLED === "false") {
    recordAdvisorRun(
      { kind: "discover", slot: opts.slot ?? null, status: "skipped", startedAt },
      db,
    );
    return { ok: true, skipped: true, reason: "discover desactivado" };
  }

  try {
    const result = await runDiscover({
      model,
      clients: opts.clients ?? realClients(),
      now,
      runAgent: opts.runAgent,
    });

    persistDiscover(db, result.confirmed, startedAt);

    recordAdvisorRun(
      {
        kind: "discover",
        slot: opts.slot ?? null,
        status: "ok",
        model,
        usage: result.usage,
        summary: result.summary,
        startedAt,
      },
      db,
    );

    if (
      process.env.DISCOVER_TELEGRAM_ENABLED !== "false" &&
      result.confirmed.length > 0
    ) {
      const lines = result.confirmed
        .slice(0, 8)
        .map((c) => `• ${c.symbol} — ${c.detail}`);
      await sendTelegram(`🔎 Discover: ${result.confirmed.length} oportunidades\n${lines.join("\n")}`);
    }

    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordAdvisorRun(
      {
        kind: "discover",
        slot: opts.slot ?? null,
        status: "error",
        model,
        errorMessage: message,
        startedAt,
      },
      db,
    );
    return { ok: false, error: message };
  }
}
