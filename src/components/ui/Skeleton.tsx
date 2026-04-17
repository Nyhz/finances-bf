import * as React from "react";
import { cn } from "@/src/lib/cn";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/70",
        className,
      )}
      {...props}
    />
  );
}
