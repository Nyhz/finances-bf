export const dynamic = "force-dynamic";

import { AssetAssignmentTable } from "@/src/components/features/objectives/AssetAssignmentTable";
import { ContributionPlanner } from "@/src/components/features/objectives/ContributionPlanner";
import { ObjectivesPanel } from "@/src/components/features/objectives/ObjectivesPanel";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import {
  getObjectivesAllocation,
  listAssignableAssets,
} from "@/src/server/objectives";

export default async function ObjectivesPage() {
  const [allocation, assets] = await Promise.all([
    getObjectivesAllocation(),
    listAssignableAssets(),
  ]);

  const taggedBuckets = allocation.buckets.filter((b) => b.objective != null);

  const objectiveOptions = allocation.buckets
    .filter((b) => b.objective != null)
    .map((b) => ({ id: b.objective!.id, name: b.objective!.name }));

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Objetivos</h1>
        <p className="text-sm text-muted-foreground">
          Tu plan de asignación: qué peso debería tener cada bloque de la cartera y
          cuánto se desvía. Total valorado:{" "}
          <SensitiveValue>{formatEur(allocation.totalValuedEur)}</SensitiveValue>
          {allocation.unassignedEur > 0 && (
            <>
              {" — "}
              <SensitiveValue>{formatEur(allocation.unassignedEur)}</SensitiveValue> sin
              objetivo asignado.
            </>
          )}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ObjectivesPanel
            buckets={allocation.buckets}
            targetSumPct={allocation.targetSumPct}
            totalValuedEur={allocation.totalValuedEur}
          />
        </div>
        <ContributionPlanner
          buckets={taggedBuckets}
          totalValuedEur={allocation.totalValuedEur}
        />
      </div>

      <AssetAssignmentTable assets={assets} objectives={objectiveOptions} />
    </div>
  );
}
