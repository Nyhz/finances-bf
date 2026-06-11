import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { DriftReport } from "@/src/server/tax/seals";

export function DriftBanner({ drift }: { drift: DriftReport }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">
        Desviación detectada respecto al sellado de este ejercicio
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>
          Neto computable:{" "}
          <SensitiveValue>{formatEur(drift.netComputableEurDelta)}</SensitiveValue>
        </li>
        <li>
          Dividendos brutos:{" "}
          <SensitiveValue>{formatEur(drift.dividendsGrossEurDelta)}</SensitiveValue>
        </li>
        <li>
          Retención origen total:{" "}
          <SensitiveValue>
            {formatEur(drift.withholdingOrigenTotalEurDelta)}
          </SensitiveValue>
        </li>
        {drift.contentChanged ? (
          <li className="font-medium">
            La composición ha cambiado — el conjunto de ventas/dividendos difiere de
            la instantánea sellada aunque los totales coincidan.
          </li>
        ) : null}
        <li>Δ n.º de ventas: {drift.salesCountDelta}</li>
        <li>Δ n.º de dividendos: {drift.dividendsCountDelta}</li>
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Acepta la edición (desellar y volver a sellar) o revierte el cambio en /transactions.
      </p>
    </div>
  );
}
