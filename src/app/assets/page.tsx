export const dynamic = "force-dynamic";

import { Badge } from "@/src/components/ui/Badge";
import { DataTable } from "@/src/components/ui/DataTable";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AssetsNewButton } from "@/src/components/features/assets/AssetsNewButton";
import { listAssets } from "@/src/server/assets";
import type { Asset } from "@/src/db/schema";

export default async function AssetsPage() {
  const rows = await listAssets();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-muted-foreground">
            Master list of tracked instruments.
          </p>
        </div>
        <AssetsNewButton />
      </header>

      {rows.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="No assets yet"
          description="Assets are created automatically from trades or added manually."
        />
      ) : (
        <DataTable<Asset>
          rows={rows}
          getRowKey={(r) => r.id}
          columns={[
            { key: "symbol", header: "Symbol", cell: (r) => r.symbol ?? "—" },
            { key: "name", header: "Name", cell: (r) => r.name },
            { key: "type", header: "Type", cell: (r) => r.assetType },
            { key: "currency", header: "Currency", cell: (r) => r.currency },
            {
              key: "active",
              header: "Status",
              cell: (r) =>
                r.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge>Inactive</Badge>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
