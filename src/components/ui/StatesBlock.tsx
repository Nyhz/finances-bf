import * as React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/src/lib/cn";
import { Skeleton } from "@/src/components/ui/Skeleton";
import { Button } from "@/src/components/ui/Button";

type LoadingState = {
  mode: "loading";
  className?: string;
};

type EmptyState = {
  mode: "empty";
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  cta?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
};

type ErrorState = {
  mode: "error";
  message: React.ReactNode;
  onRetry?: () => void;
  className?: string;
};

export type StatesBlockProps = LoadingState | EmptyState | ErrorState;

export function StatesBlock(props: StatesBlockProps) {
  if (props.mode === "loading") {
    return (
      <div className={cn("flex flex-col gap-3 p-6", props.className)}>
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (props.mode === "empty") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-10 text-center",
          props.className,
        )}
      >
        <div className="text-muted-foreground">
          {props.icon ?? <Inbox className="h-8 w-8" />}
        </div>
        <h3 className="text-sm font-semibold">{props.title}</h3>
        {props.description && (
          <p className="max-w-md text-sm text-muted-foreground">
            {props.description}
          </p>
        )}
        {props.cta &&
          (props.cta.href ? (
            <Button variant="primary" size="sm" asChild>
              <a href={props.cta.href}>{props.cta.label}</a>
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={props.cta.onClick}>
              {props.cta.label}
            </Button>
          ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-10 text-center",
        props.className,
      )}
    >
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm text-foreground">{props.message}</p>
      {props.onRetry && (
        <Button variant="secondary" size="sm" onClick={props.onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
