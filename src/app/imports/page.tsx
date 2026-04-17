export const dynamic = "force-dynamic";

import { Badge } from "@/src/components/ui/Badge";
import { DataTable } from "@/src/components/ui/DataTable";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { ImportWizardButton } from "@/src/components/features/imports/ImportWizard";
import { listAuditEvents } from "@/src/server/audit";
import { listAccounts } from "@/src/server/accounts";
import { formatDateTime } from "@/src/lib/format";
import type { AuditEvent } from "@/src/db/schema";

type ImportSummary = {
  source: string;
  accountId: string;
  inserted: number;
  insertedTrades: number;
  insertedCashMovements: number;
  skippedDuplicates: number;
  skippedErrors?: number;
  createdAssets: number;
};

function parseNext(ev: AuditEvent): ImportSummary | null {
  if (!ev.nextJson) return null;
  try {
    return JSON.parse(ev.nextJson) as ImportSummary;
  } catch {
    return null;
  }
}

export default async function ImportsPage() {
  const [{ items }, accounts] = await Promise.all([
    listAuditEvents({ entityType: "import", limit: 50 }),
    listAccounts(),
  ]);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="text-sm text-muted-foreground">
            CSV import batches — DEGIRO, Binance, Cobas.
          </p>
        </div>
        <ImportWizardButton accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
      </header>

      {items.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No imports yet"
          description="Upload a CSV to import trades and cash movements."
        />
      ) : (
        <DataTable<AuditEvent>
          rows={items}
          getRowKey={(r) => r.id}
          columns={[
            {
              key: "when",
              header: "When",
              cell: (r) => formatDateTime(r.createdAt),
            },
            {
              key: "source",
              header: "Source",
              cell: (r) => {
                const s = parseNext(r);
                return s?.source ?? "—";
              },
            },
            {
              key: "account",
              header: "Account",
              cell: (r) => {
                const s = parseNext(r);
                const name = s ? accountNames.get(s.accountId) : null;
                return name ?? "—";
              },
            },
            {
              key: "counts",
              header: "Counts",
              cell: (r) => {
                const s = parseNext(r);
                if (!s) return "—";
                return (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="success">{s.inserted} inserted</Badge>
                    {s.skippedDuplicates > 0 && (
                      <Badge variant="neutral">
                        {s.skippedDuplicates} duplicate
                      </Badge>
                    )}
                    {s.createdAssets > 0 && (
                      <Badge variant="warning">
                        {s.createdAssets} new asset
                      </Badge>
                    )}
                  </div>
                );
              },
            },
            {
              key: "summary",
              header: "Summary",
              cell: (r) => (
                <span className="text-muted-foreground">{r.summary ?? ""}</span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
