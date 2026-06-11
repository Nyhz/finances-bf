export const dynamic = "force-dynamic";

import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AssetsNewButton } from "@/src/components/features/assets/AssetsNewButton";
import { AssetsTable } from "@/src/components/features/assets/AssetsTable";
import { listAssetsWithFreshness } from "@/src/server/assets";

export default async function AssetsPage() {
  const rows = await listAssetsWithFreshness();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activos</h1>
          <p className="text-sm text-muted-foreground">
            Listado maestro de instrumentos seguidos.
          </p>
        </div>
        <AssetsNewButton />
      </header>

      {rows.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin activos"
          description="Los activos se crean automáticamente a partir de operaciones o se añaden a mano."
        />
      ) : (
        <AssetsTable rows={rows} />
      )}
    </div>
  );
}
