"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur, formatEurCompact } from "@/src/lib/format";

export type AccountBarRow = {
  name: string;
  cashEur: number;
  investedEur: number;
};

type TooltipEntry = { payload?: AccountBarRow };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

export function AccountsBarChart({ rows }: { rows: AccountBarRow[] }) {
  const renderTooltip = (props: ChartTooltipProps) => {
    const p = props.payload?.[0]?.payload;
    if (!props.active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{p.name}</p>
        <p className="text-sm font-semibold text-foreground">
          Invertido: <SensitiveValue>{formatEur(p.investedEur)}</SensitiveValue>
        </p>
        <p className="text-sm font-semibold text-foreground">
          Efectivo: <SensitiveValue>{formatEur(p.cashEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          Total: <SensitiveValue>{formatEur(p.investedEur + p.cashEur)}</SensitiveValue>
        </p>
      </div>
    );
  };

  const height = Math.max(200, rows.length * 56);

  return (
    <div className="flex flex-col gap-4">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" barCategoryGap="28%">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.45}
            horizontal={false}
          />
          <XAxis
            className="sensitive"
            type="number"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={formatEurCompact}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            width={130}
          />
          <Tooltip content={renderTooltip as never} cursor={{ fill: "hsl(var(--accent))", fillOpacity: 0.25 }} />
          <Bar
            dataKey="investedEur"
            stackId="total"
            fill="hsl(var(--chart-1))"
            isAnimationActive={false}
          />
          <Bar
            dataKey="cashEur"
            stackId="total"
            fill="hsl(var(--chart-2))"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-5 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-1" aria-hidden />
          Invertido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-2" aria-hidden />
          Efectivo
        </span>
      </div>
    </div>
  );
}
