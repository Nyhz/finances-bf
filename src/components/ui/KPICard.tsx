import * as React from "react";
import { cn } from "@/src/lib/cn";
import { Card } from "@/src/components/ui/Card";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";

export type KPICardProps = {
  label: string;
  value: React.ReactNode;
  delta?: {
    value: React.ReactNode;
    direction?: "up" | "down" | "flat";
  };
  icon?: React.ReactNode;
  className?: string;
};

export function KPICard({ label, value, delta, icon, className }: KPICardProps) {
  const deltaColor =
    delta?.direction === "up"
      ? "text-success"
      : delta?.direction === "down"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <Card className={cn("p-0", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <SensitiveValue className="text-2xl font-semibold tracking-tight">
            {value}
          </SensitiveValue>
          {delta && (
            <span className={cn("text-xs tabular-nums", deltaColor)}>
              {delta.value}
            </span>
          )}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
    </Card>
  );
}
