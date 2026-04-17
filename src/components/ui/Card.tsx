import * as React from "react";
import { cn } from "@/src/lib/cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
};

export function Card({
  title,
  action,
  footer,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          {title ? (
            <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
      {footer && (
        <div className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}
