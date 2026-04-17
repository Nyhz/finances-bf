export const dynamic = "force-dynamic";

import { Badge } from "@/src/components/ui/Badge";
import { DataTable } from "@/src/components/ui/DataTable";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { ImportCsvButton } from "@/src/components/features/imports/ImportCsvButton";
import { listImportBatches } from "@/src/server/imports";
import { formatDateTime } from "@/src/lib/format";
import type { TransactionImport } from "@/src/db/schema";

function statusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

export default async function ImportsPage() {
  const rows = await listImportBatches();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="text-sm text-muted-foreground">
            CSV import batches — DEGIRO, Binance, Cobas.
          </p>
        </div>
        <ImportCsvButton />
      </header>

      {rows.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No imports yet"
          description="Importers land in the next campaign."
        />
      ) : (
        <DataTable<TransactionImport>
          rows={rows}
          getRowKey={(r) => r.id}
          columns={[
            { key: "source", header: "Source", cell: (r) => r.format },
            {
              key: "startedAt",
              header: "Started",
              cell: (r) => formatDateTime(r.createdAt),
            },
            {
              key: "rows",
              header: "Rows",
              align: "right",
              cell: (r) => (
                <span className="tabular-nums">{r.totalRows}</span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => (
                <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
