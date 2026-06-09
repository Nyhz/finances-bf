import { db } from "../../../../db/client";
import { yahooProvider, coingeckoProvider } from "../../../../lib/pricing";
import { withRetry } from "../../../../lib/pricing/_net";
import { syncPrices } from "../../../../lib/price-sync";

// Audit R3: single-process in-flight guard. Two overlapping cron hits would
// interleave at await points between existence checks and writes; the second
// caller gets a 409 instead.
let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (running) {
    return Response.json(
      { ok: false, error: "sync already running" },
      { status: 409 },
    );
  }
  running = true;
  try {
    const summary = await syncPrices(db, {
      // Cron path: transient provider failures retry with backoff (audit R1).
      yahoo: { fetchQuote: (s) => withRetry(() => yahooProvider.fetchQuote(s)) },
      coingecko: { fetchQuote: (s) => withRetry(() => coingeckoProvider.fetchQuote(s)) },
    });
    return Response.json({ ok: true, summary });
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
