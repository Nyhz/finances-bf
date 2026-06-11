export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Card } from "@/src/components/ui/Card";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { DataTable } from "@/src/components/ui/DataTable";
import { SensitiveValue } from "@/src/components/ui/SensitiveValue";
import { ChartCardSkeleton } from "@/src/components/features/overview/skeletons";
import { AccountsBarChart } from "@/src/components/features/statement/AccountsBarChart";
import { AllocationDonut } from "@/src/components/features/statement/AllocationDonut";
import { StatementExportMenu } from "@/src/components/features/statement/StatementExportMenu";
import { StatementValueChart } from "@/src/components/features/statement/StatementValueChart";
import { TypePnlChart } from "@/src/components/features/statement/TypePnlChart";
import { cn } from "@/src/lib/cn";
import { formatDateTime, formatEur, formatPercent } from "@/src/lib/format";
import {
  OVERVIEW_RANGES,
  getNetWorthSeries,
  type OverviewRange,
} from "@/src/server/overview";
import {
  getStatementReport,
  type StatementAccountLine,
  type StatementReport,
} from "@/src/server/statement";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseRange(value: string | string[] | undefined): OverviewRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (OVERVIEW_RANGES as string[]).includes(raw)) {
    return raw as OverviewRange;
  }
  return "ALL";
}

function RangeTabs({ range }: { range: OverviewRange }) {
  return (
    <div className="flex items-center gap-1">
      {OVERVIEW_RANGES.map((r) => (
        <Link
          key={r}
          href={r === "ALL" ? "/statement" : `/statement?range=${r}`}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            r === range
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {r === "ALL" ? "Todo" : r}
        </Link>
      ))}
    </div>
  );
}

// Display-only labels — raw accountType values stay English in the DB.
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  broker: "Bróker",
  investment: "Inversión",
  crypto: "Cripto",
  savings: "Efectivo",
  bank: "Banco",
};

function KpiRow({ report }: { report: StatementReport }) {
  const { totals } = report;
  const pnlTone =
    totals.unrealizedPnlEur > 0
      ? "text-success"
      : totals.unrealizedPnlEur < 0
        ? "text-destructive"
        : "";
  return (
    <Card className="p-0">
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Valor total a precios de mercado: efectivo más posiciones valoradas."
          >
            Patrimonio total
          </span>
          <SensitiveValue className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatEur(totals.netWorthEur)}
          </SensitiveValue>
          <span className="text-xs text-muted-foreground">
            Efectivo <SensitiveValue>{formatEur(totals.cashEur)}</SensitiveValue> · invertido{" "}
            <SensitiveValue>{formatEur(totals.investedMarketValueEur)}</SensitiveValue>
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-5">
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            title="Diferencia entre el valor de mercado actual y lo que pagaste (comisiones incluidas). No tributa hasta que vendas."
          >
            Plusvalía latente
          </span>
          <span className="flex items-baseline gap-2">
            <SensitiveValue
              className={`text-3xl font-semibold tracking-tight tabular-nums ${pnlTone}`}
            >
              {formatEur(totals.unrealizedPnlEur)}
            </SensitiveValue>
            {totals.unrealizedPnlPct != null && (
              <span className={`text-sm font-medium tabular-nums ${pnlTone}`}>
                {`${totals.unrealizedPnlPct >= 0 ? "+" : ""}${formatPercent(
                  totals.unrealizedPnlPct,
                )}`}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            Sobre el coste de compra — no tributa hasta vender.
          </span>
        </div>
      </div>
    </Card>
  );
}

async function ValueChartCard({ range }: { range: OverviewRange }) {
  const series = await getNetWorthSeries({ range, accountIds: [] });
  return (
    <Card title="Evolución del valor" action={<RangeTabs range={range} />}>
      {series.length === 0 ? (
        <StatesBlock
          mode="empty"
          title="Sin historial de valoraciones"
          description="Las valoraciones diarias aparecerán cuando se sincronicen precios y haya transacciones."
        />
      ) : (
        <StatementValueChart data={series} />
      )}
    </Card>
  );
}

function AccountsTable({ accounts }: { accounts: StatementAccountLine[] }) {
  return (
    <DataTable<StatementAccountLine>
      rows={accounts}
      getRowKey={(a) => a.accountId}
      columns={[
        {
          key: "name",
          header: "Cuenta",
          cell: (a) => (
            <div className="flex flex-col">
              <span className="font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType} · {a.currency}
              </span>
            </div>
          ),
        },
        {
          key: "cash",
          header: "Efectivo",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.cashEur)}</SensitiveValue>
          ),
        },
        {
          key: "invested",
          header: "Invertido",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm">{formatEur(a.investedEur)}</SensitiveValue>
          ),
        },
        {
          key: "total",
          header: "Total",
          align: "right",
          cell: (a) => (
            <SensitiveValue className="text-sm font-medium">
              {formatEur(a.totalEur)}
            </SensitiveValue>
          ),
        },
      ]}
    />
  );
}

export default async function StatementPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const range = parseRange(params.range);
  const report = await getStatementReport();
  const hasPositions = report.totals.positionsCount > 0;

  const slices = report.groups
    .filter((g) => g.marketValueEur > 0)
    .map((g) => ({
      assetType: g.assetType,
      valueEur: g.marketValueEur,
      weight: g.weight,
    }));
  const pnlRows = report.groups.map((g) => ({
    assetType: g.assetType,
    pnlEur: g.pnlEur,
  }));
  const accountBars = report.accounts
    .filter((a) => a.totalEur !== 0)
    .map((a) => ({ name: a.name, cashEur: a.cashEur, investedEur: a.investedEur }));

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Extracto</h1>
          <p className="text-sm text-muted-foreground">
            Extracto completo de la cartera a {formatDateTime(report.generatedAt)} — todas
            las cuentas y activos, valorados en EUR.
          </p>
        </div>
        <StatementExportMenu />
      </header>

      <KpiRow report={report} />

      <Suspense
        key={`value:${range}`}
        fallback={<ChartCardSkeleton title="Evolución del valor" />}
      >
        <ValueChartCard range={range} />
      </Suspense>

      {hasPositions ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <Card title="Reparto por tipo de activo">
            {slices.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin posiciones valoradas"
                description="El reparto aparecerá cuando las posiciones tengan precio sincronizado."
              />
            ) : (
              <AllocationDonut
                slices={slices}
                totalEur={report.totals.investedMarketValueEur}
              />
            )}
          </Card>
          <Card title="Valor por cuenta">
            {accountBars.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin saldos"
                description="Los saldos aparecerán cuando las cuentas tengan actividad."
              />
            ) : (
              <AccountsBarChart rows={accountBars} />
            )}
          </Card>
          <Card title="Plusvalía latente por tipo">
            {pnlRows.length === 0 ? (
              <StatesBlock
                mode="empty"
                title="Sin plusvalía aún"
                description="Aparecerá cuando las posiciones tengan precio sincronizado."
              />
            ) : (
              <TypePnlChart rows={pnlRows} />
            )}
          </Card>
        </section>
      ) : (
        <StatesBlock
          mode="empty"
          title="Sin posiciones abiertas"
          description="Registra transacciones para construir tu extracto."
        />
      )}

      <Card title="Cuentas">
        {report.accounts.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="Sin cuentas"
            description="Crea una cuenta para empezar a registrar tu cartera."
          />
        ) : (
          <AccountsTable accounts={report.accounts} />
        )}
      </Card>
    </div>
  );
}
