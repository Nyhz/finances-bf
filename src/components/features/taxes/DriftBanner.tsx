import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { DriftReport } from "@/src/server/tax/seals";

export function DriftBanner({ drift }: { drift: DriftReport }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">
        Drift detected since this year was sealed
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>
          Net computable:{" "}
          <SensitiveValue>{formatEur(drift.netComputableEurDelta)}</SensitiveValue>
        </li>
        <li>
          Dividends gross:{" "}
          <SensitiveValue>{formatEur(drift.dividendsGrossEurDelta)}</SensitiveValue>
        </li>
        <li>
          Retención origen total:{" "}
          <SensitiveValue>
            {formatEur(drift.withholdingOrigenTotalEurDelta)}
          </SensitiveValue>
        </li>
        <li>Sales count Δ: {drift.salesCountDelta}</li>
        <li>Dividends count Δ: {drift.dividendsCountDelta}</li>
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Either accept the edit (unseal and reseal) or revert the change in /transactions.
      </p>
    </div>
  );
}
