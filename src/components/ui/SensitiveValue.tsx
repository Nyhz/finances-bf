import * as React from "react";
import { cn } from "@/src/lib/cn";

type AllowedTag = "span" | "div" | "td" | "strong" | "em" | "p";

export type SensitiveValueProps = {
  as?: AllowedTag;
  className?: string;
  children: React.ReactNode;
};

export function SensitiveValue({
  as: Tag = "span",
  className,
  children,
}: SensitiveValueProps) {
  return (
    <Tag className={cn("sensitive tabular-nums", className)}>{children}</Tag>
  );
}
