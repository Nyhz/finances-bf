"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { assetTypeLabel } from "@/src/components/ui/AssetTypeBadge";
import { formatEur, formatEurCompact } from "@/src/lib/format";

export type TypePnlRow = {
  assetType: string;
  pnlEur: number;
};

type TooltipEntry = { payload?: TypePnlRow };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

export function TypePnlChart({ rows }: { rows: TypePnlRow[] }) {
  const renderTooltip = (props: ChartTooltipProps) => {
    const p = props.payload?.[0]?.payload;
    if (!props.active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{assetTypeLabel(p.assetType)}</p>
        <p className="text-sm font-semibold text-foreground">
          <SensitiveValue>
            {`${p.pnlEur >= 0 ? "+" : ""}${formatEur(p.pnlEur)}`}
          </SensitiveValue>
        </p>
      </div>
    );
  };

  const height = Math.max(200, rows.length * 56);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows.map((row) => ({
          ...row,
          fill: row.pnlEur >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))",
        }))}
        layout="vertical"
        barCategoryGap="28%"
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          strokeOpacity={0.45}
          horizontal={false}
        />
        <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} />
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
          dataKey="assetType"
          stroke="hsl(var(--muted-foreground))"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
          tickFormatter={assetTypeLabel}
          width={110}
        />
        <Tooltip
          content={renderTooltip as never}
          cursor={{ fill: "hsl(var(--accent))", fillOpacity: 0.25 }}
        />
        <Bar dataKey="pnlEur" radius={[0, 4, 4, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
