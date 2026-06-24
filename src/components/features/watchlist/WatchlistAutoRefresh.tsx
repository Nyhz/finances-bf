"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// Soft-refreshes the Watchlist server component on an interval so an open tab
// shows fresh quotes/indicators/alert states without a manual reload. The cron
// writes new prices every ~5 min; polling at 60s surfaces them within a minute.
// `router.refresh()` re-fetches the RSC payload in place — no flash, no skeleton.
export function WatchlistAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
