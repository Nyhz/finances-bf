import { listUnacknowledgedAlertEvents } from "@/src/server/alerts";
import { AlertBanner } from "./AlertBanner";

// Server wrapper: reads the current unacknowledged alerts so the banner renders
// immediately on first paint, then the client component keeps it fresh by polling.
export async function AlertBannerMount() {
  const events = await listUnacknowledgedAlertEvents();
  return <AlertBanner initialEvents={events} />;
}
