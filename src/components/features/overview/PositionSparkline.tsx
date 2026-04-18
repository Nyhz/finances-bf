"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

type Point = {
  date: string;
  valueEur: number;
  investedEur: number;
  unitPriceEur: number;
};

const BASELINE = 100;
const EDGE_PADDING_RATIO = 0.08;
const MIN_EDGE_PADDING = 0.5;

export function PositionSparkline({ data, id }: { data: Point[]; id: string }) {
  if (data.length < 2) {
    return <span className="text-muted-foreground">—</span>;
  }
  // Pure price performance: normalize each point to the first non-zero unit
  // price in the window. This reflects the asset's own market move,
  // independent of the user's buys/sells.
  const basePrice =
    data.find((p) => p.unitPriceEur > 0)?.unitPriceEur ?? 0;
  if (basePrice <= 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const series = data.map((p) => ({
    marketIndex: (p.unitPriceEur / basePrice) * BASELINE,
  }));

  const stroke = "hsl(var(--primary))";
  const gradientId = `spark-${id}`;

  const values = series.map((d) => d.marketIndex);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const pad =
    spread === 0
      ? Math.max(Math.abs(max) * 0.005, MIN_EDGE_PADDING)
      : Math.max(spread * EDGE_PADDING_RATIO, MIN_EDGE_PADDING);
  const domain: [number, number] = [min - pad, max + pad];

  return (
    <div className="h-12 w-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={series}
          margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={stroke} stopOpacity={0.38} />
              <stop offset="95%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={domain} />
          <Area
            type="monotone"
            dataKey="marketIndex"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
