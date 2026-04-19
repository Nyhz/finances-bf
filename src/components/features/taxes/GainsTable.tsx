"use client";

import React, { useState } from "react";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatDate, formatEur } from "@/src/lib/format";
import type { SaleReportRow } from "@/src/server/tax/report";
import { GainsLotDetail } from "./GainsLotDetail";

type Props = { sales: SaleReportRow[] };

export function GainsTable({ sales }: Props) {
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
                    <td>{s.assetName ?? s.assetId}</td>
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
    </Card>
  );
}
