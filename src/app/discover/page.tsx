export const dynamic = "force-dynamic";

import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { DiscoverCard } from "@/src/components/features/discover/DiscoverCard";
import { DiscoverRunPanel } from "@/src/components/features/discover/DiscoverRunPanel";
import { DISCOVER_CRITERIA } from "@/src/lib/discover/criteria";
import { getLastDiscoverRun, listDiscoverCandidates } from "@/src/server/discover";
import type { DiscoverCandidate } from "@/src/db/schema";

function lastRunLabel(startedAt: number): string {
  return new Date(startedAt).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DiscoverPage() {
  const [candidates, lastRun] = await Promise.all([
    listDiscoverCandidates(),
    getLastDiscoverRun(),
  ]);

  // Group by baremo, preserving the criteria registry order.
  const byCriterion = new Map<string, DiscoverCandidate[]>();
  for (const c of candidates) {
    const list = byCriterion.get(c.criterion) ?? [];
    list.push(c);
    byCriterion.set(c.criterion, list);
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <DiscoverRunPanel
        header={
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Descubrir</h1>
            <p className="text-sm text-muted-foreground">
              Oportunidades que Claude rastrea en el mercado y nosotros verificamos con datos reales.
              Búsqueda semanal (lunes) o bajo demanda.
            </p>
            {lastRun && (
              <p className="mt-1 text-xs text-muted-foreground">
                Última búsqueda: {lastRunLabel(lastRun.startedAt)}
                {lastRun.summary ? ` · ${lastRun.summary}` : ""}
                {lastRun.status === "error" ? " · ⚠ con error" : ""}
              </p>
            )}
          </div>
        }
      />

      {candidates.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin oportunidades todavía"
          description="Lanza una búsqueda con «Descubrir ahora» o espera al rastreo semanal del lunes."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {DISCOVER_CRITERIA.filter((c) => byCriterion.has(c.key)).map((criterion) => (
            <section key={criterion.key} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
                {criterion.label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {byCriterion.get(criterion.key)!.map((candidate) => (
                  <DiscoverCard key={candidate.id} candidate={candidate} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
