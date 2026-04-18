import { Card } from "@/src/components/ui/Card";
import { Skeleton } from "@/src/components/ui/Skeleton";

export function KpiRowSkeleton() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-5 shadow-sm"
        >
          <Skeleton className="mb-3 h-3 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      ))}
    </section>
  );
}

export function ChartCardSkeleton({ title }: { title: string }) {
  return (
    <Card title={title}>
      <Skeleton className="h-64 w-full" />
    </Card>
  );
}

export function TableCardSkeleton({ title, rows = 6 }: { title: string; rows?: number }) {
  return (
    <Card title={title}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}
