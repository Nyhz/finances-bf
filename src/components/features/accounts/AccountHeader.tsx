import { Badge } from "@/src/components/ui/Badge";
import { KPICard } from "@/src/components/ui/KPICard";
import { formatEur } from "@/src/lib/format";
import type { Account } from "@/src/db/schema";
import { isCashBearingAccount } from "@/src/actions/_constants";
import { ReimportAccountButton } from "@/src/components/features/accounts/ReimportAccountButton";

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
        <div className="flex items-center gap-2">
          <a
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            href={`/api/exports/account-statement?accountId=${account.id}`}
          >
            Export statement
          </a>
          <ReimportAccountButton accountId={account.id} />
        </div>
      </div>

      {(() => {
        const showCash = isCashBearingAccount(account.accountType);
        const cash = showCash ? account.currentCashBalanceEur : 0;
        return (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showCash && <KPICard label="Cash (EUR)" value={formatEur(cash)} />}
            <KPICard label="Holdings" value={String(holdingsCount)} />
            <KPICard
              label="Total Value (EUR)"
              value={formatEur(cash + totalValueEur)}
            />
          </section>
        );
      })()}
    </header>
  );
}
