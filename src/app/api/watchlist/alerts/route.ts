import { listUnacknowledgedAlertEvents } from "../../../../server/alerts";

export const dynamic = "force-dynamic";

// Read endpoint polled by the global alert banner so a freshly fired alert
// surfaces without a manual reload. LAN single-user app — no auth (SPEC §11).
export async function GET(): Promise<Response> {
  const events = await listUnacknowledgedAlertEvents();
  return Response.json({ events });
}
