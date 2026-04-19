import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { SaleReportRow } from "@/src/server/tax/report";

export function GainsLotDetail({ sale }: { sale: SaleReportRow }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm">
      <div className="mb-2 font-medium">FIFO lots consumed</div>
      <table className="w-full">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left">Acquired</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Cost basis (EUR)</th>
          </tr>
        </thead>
        <tbody>
          {sale.consumedLots.map((l) => (
            <tr key={l.lotId} className="border-t border-border/20">
              <td>{formatDate(l.acquiredAt)}</td>
              <td className="text-right tabular-nums">{l.qtyConsumed.toFixed(6)}</td>
              <td className="text-right tabular-nums">
                <SensitiveValue>{formatEur(l.costBasisEur)}</SensitiveValue>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sale.nonComputableLossEur > 0 ? (
        <div className="mt-2 text-destructive">
          Wash-sale (art. 33.5.f/g): non-computable portion{" "}
          <SensitiveValue>{formatEur(sale.nonComputableLossEur)}</SensitiveValue>
        </div>
      ) : null}
    </div>
  );
}
