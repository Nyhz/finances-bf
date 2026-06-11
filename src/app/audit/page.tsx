export const dynamic = "force-dynamic";

import Link from "next/link";
import { Button } from "@/src/components/ui/Button";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AuditTable } from "@/src/components/features/audit/AuditTable";
import { AuditFilters } from "@/src/components/features/audit/AuditFilters";
import { listAuditEvents, type ListAuditEventsArgs } from "@/src/server/audit";

type SearchParams = Promise<{
  entityType?: string;
  entityId?: string;
  action?: string;
  source?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}>;

function parseDay(value: string | undefined, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const filter: ListAuditEventsArgs = {
    limit: 50,
    cursor: sp.cursor,
    entityType: sp.entityType || undefined,
    entityId: sp.entityId || undefined,
    action: sp.action || undefined,
    source: sp.source || undefined,
    dateFrom: parseDay(sp.dateFrom, false),
    dateTo: parseDay(sp.dateTo, true),
  };
  const hasAnyFilter = Boolean(
    filter.entityType ||
      filter.entityId ||
      filter.action ||
      filter.source ||
      filter.dateFrom !== undefined ||
      filter.dateTo !== undefined,
  );

  const result = await listAuditEvents(filter);

  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "cursor") continue;
    if (typeof v === "string" && v) baseParams.set(k, v);
  }
  const nextParams = new URLSearchParams(baseParams);
  if (result.nextCursor) nextParams.set("cursor", result.nextCursor);
  const nextHref = result.nextCursor
    ? `/audit?${nextParams.toString()}`
    : null;
  const prevHref = sp.cursor
    ? baseParams.toString()
      ? `/audit?${baseParams.toString()}`
      : "/audit"
    : null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoría</h1>
        <p className="text-sm text-muted-foreground">
          Registro cronológico de mutaciones en cuentas, activos y transacciones.
        </p>
      </header>

      <AuditFilters />

      {result.items.length === 0 ? (
        hasAnyFilter || sp.cursor ? (
          <StatesBlock
            mode="empty"
            title="Ningún evento de auditoría coincide con estos filtros"
            description="Prueba a ampliar el tipo de entidad, quitar el rango de fechas o restablecer los filtros."
          />
        ) : (
          <StatesBlock
            mode="empty"
            title="Sin eventos de auditoría"
            description="Cada mutación escribe un evento de auditoría. Aparecerán aquí en cuanto crees o edites datos."
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <AuditTable rows={result.items} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{result.items.length} filas</span>
            <span className="flex items-center gap-2">
              {prevHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={prevHref}>Anterior</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Anterior
                </Button>
              )}
              {nextHref ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={nextHref}>Siguiente</Link>
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Siguiente
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
