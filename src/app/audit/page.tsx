export const dynamic = "force-dynamic";

import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AuditTable } from "@/src/components/features/audit/AuditTable";
import { listAuditEvents } from "@/src/server/audit";

export default async function AuditPage() {
  const result = await listAuditEvents({ limit: 50 });

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
        <p className="text-sm text-muted-foreground">
          Chronological log of mutations across accounts, assets, and transactions.
        </p>
      </header>

      {result.items.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No audit events yet"
          description="Every mutation writes an audit event. They appear here once you create or edit data."
        />
      ) : (
        <AuditTable rows={result.items} />
      )}
    </div>
  );
}
