import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { DividendReportRow } from "@/src/server/tax/report";
import { ddiTreatyRate } from "@/src/server/tax/countries";

export function DividendsTable({ dividends }: { dividends: DividendReportRow[] }) {
  if (dividends.length === 0) {
    return (
      <Card title="Rendimientos del capital mobiliario">
        <p className="text-sm text-muted-foreground p-4">No dividends this year.</p>
      </Card>
    );
  }
  return (
    <Card title={`Rendimientos del capital mobiliario (${dividends.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left">Date</th>
              <th className="text-left">Asset</th>
              <th className="text-left">Country</th>
              <th className="text-right">Gross</th>
              <th className="text-right">Ret. origen</th>
              <th className="text-right">Ret. destino</th>
              <th className="text-right">Net</th>
              <th className="text-right">DDI cap</th>
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
                  <td className="text-right tabular-nums"><SensitiveValue>{formatEur(d.grossEur)}</SensitiveValue></td>
                  <td className="text-right tabular-nums"><SensitiveValue>{formatEur(d.withholdingOrigenEur)}</SensitiveValue></td>
                  <td className="text-right tabular-nums"><SensitiveValue>{formatEur(d.withholdingDestinoEur)}</SensitiveValue></td>
                  <td className="text-right tabular-nums font-medium"><SensitiveValue>{formatEur(d.netEur)}</SensitiveValue></td>
                  <td className="text-right tabular-nums"><SensitiveValue>{formatEur(ddiCreditable)}</SensitiveValue></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
