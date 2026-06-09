"use client";

import React, { useState } from "react";
import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { SaleReportRow, TaxReport } from "@/src/server/tax/report";
import { GainsLotDetail } from "./GainsLotDetail";

type Props = {
  sales: SaleReportRow[];
  excludedSales?: TaxReport["excludedSales"];
};

export function GainsTable({ sales, excludedSales }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  if (sales.length === 0) {
    return (
      <Card title="Ganancias patrimoniales">
        <p className="text-sm text-muted-foreground p-4">No sales this year.</p>
      </Card>
    );
  }
  return (
    <Card title={`Ganancias patrimoniales (${sales.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th></th>
              <th className="text-left">Date</th>
              <th className="text-left">Asset</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Proceeds</th>
              <th className="text-right">Cost basis</th>
              <th className="text-right">Fees</th>
              <th className="text-right">Gross G/L</th>
              <th className="text-right">Non-comp.</th>
              <th className="text-right">Computable</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const isOpen = expanded.has(s.transactionId);
              return (
                <React.Fragment key={s.transactionId}>
                  <tr className="border-t border-border/30 align-top">
                    <td>
                      <button
                        type="button"
                        className="px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => toggle(s.transactionId)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>{formatDate(s.tradedAt)}</td>
                    <td>
                      {s.assetName ?? s.assetId}
                      {s.valuationBasis === "market-fx" ? (
                        <Badge
                          variant="warning"
                          className="ml-1.5"
                          title="Crypto permuta: the EUR value of this disposal comes from the quote currency's market daily close, not user-entered data (DGT V0999-18)."
                        >
                          market-valued
                        </Badge>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{s.quantity.toFixed(6)}</td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.proceedsEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.costBasisEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.feesEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.rawGainLossEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums">
                      <SensitiveValue>{formatEur(s.nonComputableLossEur)}</SensitiveValue>
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      <SensitiveValue>{formatEur(s.computableGainLossEur)}</SensitiveValue>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td></td>
                      <td colSpan={9} className="pb-3">
                        <GainsLotDetail sale={s} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {excludedSales && excludedSales.count > 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Dust filter: {excludedSales.count} micro-disposal
          {excludedSales.count === 1 ? "" : "s"} excluded (proceeds{" "}
          <SensitiveValue>{formatEur(excludedSales.proceedsEur)}</SensitiveValue>, cost
          basis <SensitiveValue>{formatEur(excludedSales.costBasisEur)}</SensitiveValue>).
        </p>
      ) : null}
    </Card>
  );
}
