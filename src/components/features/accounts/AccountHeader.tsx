import { Badge } from "@/src/components/ui/Badge";
import { KPICard } from "@/src/components/ui/KPICard";
import { formatEur } from "@/src/lib/format";
import type { Account } from "@/src/db/schema";

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
            <span>{account.accountType}</span>
            <span aria-hidden>·</span>
            <Badge variant="neutral">{account.currency}</Badge>
          </div>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard label="Cash (EUR)" value={formatEur(account.currentCashBalanceEur)} />
        <KPICard label="Holdings" value={String(holdingsCount)} />
        <KPICard
          label="Total Value (EUR)"
          value={formatEur(account.currentCashBalanceEur + totalValueEur)}
        />
      </section>
    </header>
  );
}
