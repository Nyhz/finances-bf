import { db } from "../../../../db/client";
import { coingeckoProvider } from "../../../../lib/pricing";
import {
  backfillCryptoPrices,
  backfillCryptoValuations,
} from "../../../../lib/price-backfill";

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const prices = await backfillCryptoPrices(db, {
      fetchHistory: coingeckoProvider.fetchHistory,
    });
    const valuations = await backfillCryptoValuations(db);
    return Response.json({ ok: true, prices, valuations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
