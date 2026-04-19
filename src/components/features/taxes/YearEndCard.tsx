import { Card } from "@/src/components/ui/Card";
import { Badge } from "@/src/components/ui/Badge";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { formatEur } from "@/src/lib/format";
import type { AnnotatedBlock, InformationalModelsStatus } from "@/src/server/tax/m720";

const STATUS_COLORS: Record<AnnotatedBlock["status"], string> = {
  ok: "bg-muted text-muted-foreground",
  new: "bg-amber-500/20 text-amber-300",
  delta_20k: "bg-amber-500/20 text-amber-300",
  full_exit: "bg-blue-500/20 text-blue-300",
};

function BlockList({ title, blocks }: { title: string; blocks: AnnotatedBlock[] }) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-border/40 p-4">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">No foreign blocks in scope.</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/40 p-4">
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 space-y-2">
        {blocks.map((b, i) => (
          <li key={`${b.country}-${b.type}-${i}`} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{b.country}</span>
              <span className="text-xs text-muted-foreground">{b.type}</span>
              <Badge className={STATUS_COLORS[b.status]}>{b.status}</Badge>
            </div>
            <div className="text-sm tabular-nums">
              <SensitiveValue>{formatEur(b.valueEur)}</SensitiveValue>
              {b.lastDeclaredEur != null ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  was <SensitiveValue>{formatEur(b.lastDeclaredEur)}</SensitiveValue>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function YearEndCard({ models }: { models: InformationalModelsStatus }) {
  return (
    <Card title="Year-end informational models">
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <BlockList title="Modelo 720 (foreign securities + accounts)" blocks={models.m720.blocks} />
        <BlockList title="Modelo 721 (foreign crypto)" blocks={models.m721.blocks} />
        <BlockList title="Modelo D-6 (foreign listed securities)" blocks={models.d6.blocks} />
      </div>
    </Card>
  );
}
