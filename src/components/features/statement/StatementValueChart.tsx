"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import type { NetWorthPoint } from "@/src/server/overview";

type Point = {
  label: string;
  dateIso: string;
  valueEur: number;
  investedEur: number;
};

type TooltipEntry = { payload?: Point };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

function formatLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function formatTooltipDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatMoney(value: number): string {
  return `${value.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}€`;
}

function formatAxisMoney(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `€${(value / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })}k`;
  }
  return `€${value.toLocaleString("es-ES", { maximumFractionDigits: 0 })}`;
}

export function StatementValueChart({ data }: { data: NetWorthPoint[] }) {
  const points: Point[] = useMemo(
    () =>
      data.map((p) => ({
        label: formatLabel(p.date),
        dateIso: p.date,
        valueEur: p.valueEur,
        investedEur: p.investedEur,
      })),
    [data],
  );

  const renderTooltip = (props: ChartTooltipProps) => {
    const { active, payload } = props;
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{formatTooltipDate(p.dateIso)}</p>
        <p className="text-sm font-semibold text-foreground">
          Value: <SensitiveValue>{formatMoney(p.valueEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          Invested: <SensitiveValue>{formatMoney(p.investedEur)}</SensitiveValue>
        </p>
      </div>
    );
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points}>
          <defs>
            <linearGradient id="statementValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            strokeOpacity={0.45}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            minTickGap={32}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
            tickFormatter={formatAxisMoney}
            width={64}
            domain={["auto", "auto"]}
          />
          <Tooltip content={renderTooltip as never} />
          <Area
            type="monotone"
            dataKey="valueEur"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            isAnimationActive={false}
            fill="url(#statementValueFill)"
          />
          <Line
            type="monotone"
            dataKey="investedEur"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-5 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-1" aria-hidden />
          Market value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-muted-foreground" aria-hidden />
          Invested capital
        </span>
      </div>
    </div>
  );
}
