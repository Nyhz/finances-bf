"use client";

import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { Prevision } from "@/src/server/tax/prevision";

type Props = {
  prevision: Prevision;
  netComputableEur: number;
};

function Row({ label, value, bold = false, negative = false }: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-1.5 text-sm">
      <span className={bold ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""}`}>
        <SensitiveValue>{formatEur(negative ? -value : value)}</SensitiveValue>
      </span>
    </div>
  );
}

/**
 * Previsión del cálculo foral: coeficientes de actualización (art. 45),
 * exención de dividendos y compensación estanca (art. 66). Reproduce lo que
 * saldrá del programa de renta — estimación, no cifras a transcribir.
 */
export function PrevisionCard({ prevision, netComputableEur }: Props) {
  const est = prevision.cuota;
  return (
    <Card title="Previsión — cálculo foral estimado">
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        {est.scaleLabel} · coeficientes DF 125/2024 / DF 115/2025 · arts. 45 y
        66 NF 13/2013. Estimación orientativa de la base del ahorro aislada —
        el cálculo vinculante es el del programa de renta foral.
      </p>
      {!prevision.coefficientsAvailable ? (
        <p className="px-4 pb-2 text-xs text-destructive">
          Sin tabla de coeficientes publicada para este ejercicio — previsión
          calculada sin actualización del coste.
        </p>
      ) : null}
      <div className="divide-y divide-border/30 border-t border-border/30">
        <Row label="Saldo histórico declarado (sin coeficientes)" value={netComputableEur} />
        <Row label="Saldo foral previsto (coste actualizado)" value={prevision.saldoGananciasForalEur} bold />
        {prevision.coefficientReliefEur !== 0 ? (
          <Row
            label="Menor ganancia por coeficientes de actualización"
            value={prevision.coefficientReliefEur}
            negative
          />
        ) : null}
        {prevision.perdidasNoComputablesEur > 0 ? (
          <Row
            label="Pérdidas no computables (recompra, art. 43)"
            value={prevision.perdidasNoComputablesEur}
          />
        ) : null}
        {est.dividendExemptionAppliedEur > 0 ? (
          <Row
            label="Exención foral de dividendos (máx. 1.500 €)"
            value={est.dividendExemptionAppliedEur}
            negative
          />
        ) : null}
        <Row label="Saldo de rendimientos del capital mobiliario" value={est.saldoRcmEur} />
        {est.lossCarryForwardEur > 0 ? (
          <Row
            label="Saldo negativo pendiente (4 ejercicios, art. 66)"
            value={est.lossCarryForwardEur}
          />
        ) : null}
        <Row label="Base liquidable del ahorro estimada" value={est.baseAhorroEur} bold />
        <Row label="Cuota íntegra estimada" value={est.cuotaIntegraEur} bold />
        <Row label="Deducción doble imposición internacional" value={est.ddiCreditEur} negative />
        <Row label="Retenciones ya practicadas en destino" value={est.withholdingDestinoEur} negative />
        <Row
          label={
            est.resultadoEstimadoEur >= 0
              ? "Resultado estimado (a ingresar)"
              : "Resultado estimado (a devolver)"
          }
          value={est.resultadoEstimadoEur}
          bold
        />
      </div>
    </Card>
  );
}
