"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatPercent } from "@/src/lib/format";
import type { AllocationSlice } from "@/src/server/overview";

const PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

type TooltipPayload = {
  name: string;
  value: number;
  payload: AllocationSlice;
};

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground shadow-sm">
      <div className="capitalize text-muted-foreground">{slice.assetClass}</div>
      <SensitiveValue className="font-medium">
        {formatEur(slice.valueEur)}
      </SensitiveValue>
      <div className="text-muted-foreground">{formatPercent(slice.weight)}</div>
    </div>
  );
}

export function AllocationDonut({ data }: { data: AllocationSlice[] }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-56 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="valueEur"
              nameKey="assetClass"
              innerRadius={50}
              outerRadius={85}
              stroke="hsl(var(--card))"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-1 flex-col gap-2 text-sm">
        {data.map((slice, i) => (
          <li
            key={slice.assetClass}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="capitalize">{slice.assetClass}</span>
            </div>
            <span className="text-muted-foreground tabular-nums">
              {formatPercent(slice.weight)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
