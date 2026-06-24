import type { AdvisorMarketStatus } from "@/src/server/advisor";
import { MarketIngestToggle } from "./MarketIngestToggle";

// Slim status row for the advisor: market-ingest toggle + last-analysis stamp.
// Deliberately no cost/billing figures (Commander's preference — cost is still
// tracked in advisor_runs, just never shown).

function relTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

function lastAnalysisLabel(market: AdvisorMarketStatus, enabled: boolean): string {
  if (market.lastUpdate == null) return enabled ? "Aún sin análisis" : "Pausado · sin análisis";
  if (!market.lastOk) return `⚠ último análisis con error · ${relTime(market.lastUpdate)}`;
  return `Último análisis: ${relTime(market.lastUpdate)}`;
}

export function AdvisorStatusBar({
  market,
  marketIngest,
}: {
  market: AdvisorMarketStatus;
  marketIngest: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <MarketIngestToggle enabled={marketIngest} />
      <span className="text-xs text-muted-foreground">
        {lastAnalysisLabel(market, marketIngest)}
      </span>
    </div>
  );
}
