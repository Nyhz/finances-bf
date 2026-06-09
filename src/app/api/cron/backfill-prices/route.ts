import { db } from "../../../../db/client";
import { coingeckoProvider } from "../../../../lib/pricing";
import { withRetry } from "../../../../lib/pricing/_net";
import {
  backfillCryptoPrices,
  backfillCryptoValuations,
} from "../../../../lib/price-backfill";

// Audit R3: single-process in-flight guard — see sync-prices route.
let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (running) {
    return Response.json(
      { ok: false, error: "backfill already running" },
      { status: 409 },
    );
  }
  running = true;
  try {
    const prices = await backfillCryptoPrices(db, {
      fetchHistory: (symbol, from, to) =>
        withRetry(() => coingeckoProvider.fetchHistory(symbol, from, to)),
    });
    const valuations = await backfillCryptoValuations(db);
    return Response.json({ ok: true, prices, valuations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    running = false;
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
