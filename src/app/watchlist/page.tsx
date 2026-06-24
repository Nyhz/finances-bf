export const dynamic = "force-dynamic";

import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { WatchlistCard } from "@/src/components/features/watchlist/WatchlistCard";
import { WatchlistAutoRefresh } from "@/src/components/features/watchlist/WatchlistAutoRefresh";
import { listWatchlist } from "@/src/server/watchlist";

export default async function WatchlistPage() {
  const items = await listWatchlist();

  return (
    <div className="flex flex-col gap-6 p-8">
      <WatchlistAutoRefresh />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          Activos en seguimiento con cotización intradía (≈5 min) y alertas de precio.
        </p>
      </header>

      {items.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Watchlist vacía"
          description="Marca un activo con la estrella en Activos para seguirlo aquí y configurar alertas."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <WatchlistCard key={item.asset.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
