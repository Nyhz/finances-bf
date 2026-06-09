"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { AssetTypeBadge } from "@/src/components/ui/AssetTypeBadge";

export type AllocationSlice = {
  assetType: string;
  valueEur: number;
  weight: number;
};

type TooltipEntry = { payload?: AllocationSlice };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[] };

function formatMoney(value: number): string {
  return `${value.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}€`;
}

function sliceColor(index: number): string {
  return `hsl(var(--chart-${(index % 5) + 1}))`;
}

export function AllocationDonut({
  slices,
  totalEur,
}: {
  slices: AllocationSlice[];
  totalEur: number;
}) {
  const renderTooltip = (props: ChartTooltipProps) => {
    const p = props.payload?.[0]?.payload;
    if (!props.active || !p) return null;
    return (
      <div className="rounded-md border border-border/70 bg-card/95 px-3 py-2 shadow-sm">
        <p className="text-xs text-muted-foreground">{p.assetType}</p>
        <p className="text-sm font-semibold text-foreground">
          <SensitiveValue>{formatMoney(p.valueEur)}</SensitiveValue>
        </p>
        <p className="text-xs text-muted-foreground">
          {(p.weight * 100).toFixed(1)}% of invested
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height={224}>
          <PieChart>
            <Tooltip content={renderTooltip as never} />
            <Pie
              data={slices.map((slice, i) => ({ ...slice, fill: sliceColor(i) }))}
              dataKey="valueEur"
              nameKey="assetType"
              innerRadius={68}
              outerRadius={96}
              paddingAngle={slices.length > 1 ? 2 : 0}
              strokeWidth={0}
              isAnimationActive={false}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Invested
          </span>
          <SensitiveValue className="text-lg font-semibold tracking-tight">
            {formatMoney(totalEur)}
          </SensitiveValue>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {slices.map((slice, i) => (
          <li key={slice.assetType} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: sliceColor(i) }}
            />
            <AssetTypeBadge type={slice.assetType} />
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {(slice.weight * 100).toFixed(1)}%
            </span>
            <SensitiveValue className="w-28 text-right text-sm font-medium">
              {formatMoney(slice.valueEur)}
            </SensitiveValue>
          </li>
        ))}
      </ul>
    </div>
  );
}
