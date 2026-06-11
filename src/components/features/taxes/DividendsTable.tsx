import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { DividendReportRow } from "@/src/server/tax/report";
import { ddiTreatyRate } from "@/src/server/tax/countries";

export function DividendsTable({ dividends }: { dividends: DividendReportRow[] }) {
  if (dividends.length === 0) {
    return (
      <Card title="Dividendos">
        <p className="p-4 text-sm text-muted-foreground">Sin dividendos en el ejercicio.</p>
      </Card>
    );
  }

  // Columnas condicionales: lo habitual es que destino sea 0 (broker
  // extranjero) — no merece una columna permanente de ceros.
  const hasOrigen = dividends.some((d) => d.withholdingOrigenEur > 0);
  const hasDestino = dividends.some((d) => d.withholdingDestinoEur > 0);

  return (
    <Card title={`Dividendos (${dividends.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Fecha</th>
              <th className="text-left">Activo</th>
              <th className="text-left" title="País de origen del pagador (por ISIN).">País</th>
              <th className="text-right" title="Dividendo bruto en EUR — lo que se declara.">
                Bruto
              </th>
              {hasOrigen ? (
                <th
                  className="text-right"
                  title="Impuesto retenido por el país de origen. Recuperable hasta el tipo del convenio vía deducción por doble imposición."
                >
                  Ret. origen
                </th>
              ) : null}
              {hasDestino ? (
                <th
                  className="text-right"
                  title="Retención española — pago a cuenta que se descuenta de la cuota."
                >
                  Ret. destino
                </th>
              ) : null}
              <th className="text-right" title="Lo que llegó a tu cuenta.">Neto</th>
              {hasOrigen ? (
                <th
                  className="text-right"
                  title="Máximo recuperable por convenio (p. ej. EE.UU. 15%): min(retención en origen, tipo convenio × bruto)."
                >
                  Recuperable
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => {
              const cap = d.sourceCountry ? ddiTreatyRate(d.sourceCountry) : 0.15;
              const ddiCreditable = Math.min(d.withholdingOrigenEur, cap * d.grossEur);
              return (
                <tr key={d.transactionId} className="border-t border-border/30">
                  <td>{formatDate(d.tradedAt)}</td>
                  <td>{d.assetName ?? d.assetId}</td>
                  <td>{d.sourceCountry ?? "—"}</td>
                  <td className="text-right tabular-nums">
                    <SensitiveValue>{formatEur(d.grossEur)}</SensitiveValue>
                  </td>
                  {hasOrigen ? (
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(d.withholdingOrigenEur)}</SensitiveValue>
                    </td>
                  ) : null}
                  {hasDestino ? (
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(d.withholdingDestinoEur)}</SensitiveValue>
                    </td>
                  ) : null}
                  <td className="text-right font-medium tabular-nums">
                    <SensitiveValue>{formatEur(d.netEur)}</SensitiveValue>
                  </td>
                  {hasOrigen ? (
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(ddiCreditable)}</SensitiveValue>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
