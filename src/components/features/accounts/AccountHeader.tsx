import { Badge } from "@/src/components/ui/Badge";
import { KPICard } from "@/src/components/ui/KPICard";
import { formatEur } from "@/src/lib/format";
import type { Account } from "@/src/db/schema";
import { isCashBearingAccount } from "@/src/actions/_constants";

// Display-only labels — the stored accountType values stay in English.
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  broker: "Bróker",
  crypto: "Cripto",
  investment: "Inversión",
  savings: "Efectivo",
};

export type AccountHeaderProps = {
  account: Account;
  holdingsCount: number;
  totalValueEur: number;
};

export function AccountHeader({
  account,
  holdingsCount,
  totalValueEur,
}: AccountHeaderProps) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{account.name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType}
            </span>
            <span aria-hidden>·</span>
            <Badge variant="neutral">{account.currency}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            href={`/api/exports/account-statement?accountId=${account.id}`}
          >
            Exportar extracto
          </a>
        </div>
      </div>

      {(() => {
        const showCash = isCashBearingAccount(account.accountType);
        const cash = showCash ? account.currentCashBalanceEur : 0;
        return (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showCash && <KPICard label="Efectivo (EUR)" value={formatEur(cash)} />}
            <KPICard label="Posiciones" value={String(holdingsCount)} />
            <KPICard
              label="Valor total (EUR)"
              value={formatEur(cash + totalValueEur)}
            />
          </section>
        );
      })()}
    </header>
  );
}
