"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";

export type AccountPerformancePoint = {
  date: string;
  balanceEur: number;
};

function formatLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function AccountPerformanceChart({
  data,
}: {
  data: AccountPerformancePoint[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatLabel}
            minTickGap={24}
          />
          <YAxis
            className="sensitive"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatEurCompact}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--border))" }}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null;
              const p = props.payload[0]?.payload as
                | AccountPerformancePoint
                | undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-background/90 px-3 py-2 text-xs shadow-sm">
                  <div className="text-muted-foreground">
                    {formatTooltipDate(p.date)}
                  </div>
                  <SensitiveValue as="div" className="font-medium">
                    {formatEur(p.balanceEur)}
                  </SensitiveValue>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="balanceEur"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
