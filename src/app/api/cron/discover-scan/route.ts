import { revalidatePath } from "next/cache";
import { toIsoDate } from "../../../../lib/time";
import { runDiscoverScan } from "../../../../lib/discover/run";

// Weekly opportunity discovery (Monday 15:30 Madrid via launchd). Runs the
// Claude agent + deterministic verification, replaces the stored candidate set.
// Shared-token gated; the run is long (web search + per-candidate history).

let running = false;

async function handle(req: Request): Promise<Response> {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (running) {
    return Response.json({ ok: false, error: "discover already running" }, { status: 409 });
  }
  running = true;
  try {
    const slot = toIsoDate(new Date()); // the Monday's date = weekly idempotency key
    const r = await runDiscoverScan({ slot });
    revalidatePath("/discover");
    return Response.json(r, { status: r.ok ? 200 : 500 });
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
