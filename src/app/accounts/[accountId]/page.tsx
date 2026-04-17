export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { Card } from "@/src/components/ui/Card";
import { StatesBlock } from "@/src/components/ui/StatesBlock";
import { AccountHeader } from "@/src/components/features/accounts/AccountHeader";
import {
  AccountLedger,
  type AccountLedgerRow,
} from "@/src/components/features/accounts/AccountLedger";
import { AccountPerformanceChart } from "@/src/components/features/accounts/AccountPerformanceChart";
import { AccountPositionsTable } from "@/src/components/features/accounts/AccountPositionsTable";
import { getAccountById, getAccountDailyBalances } from "@/src/server/accounts";
import { listAssets } from "@/src/server/assets";
import { getPositionsForAccount } from "@/src/server/positions";
import { getLedgerForAccount } from "@/src/server/transactions";

type Params = Promise<{ accountId: string }>;
type SearchParams = Promise<{ cursor?: string }>;

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { accountId } = await params;
  const { cursor } = await searchParams;

  const account = await getAccountById(accountId);
  if (!account) notFound();

  const [positions, ledger, balances, assets] = await Promise.all([
    getPositionsForAccount(accountId),
    getLedgerForAccount(accountId, { cursor, limit: 50 }),
    getAccountDailyBalances(accountId),
    listAssets(),
  ]);

  const assetSymbol = new Map(
    assets.map((a) => [a.id, a.symbol ?? a.name] as const),
  );

  const totalValueEur = positions.reduce(
    (acc, r) => acc + (r.valuationEur ?? 0),
    0,
  );

  const ledgerRows: AccountLedgerRow[] = ledger.items.map((e) => ({
    kind: e.kind,
    id: e.id,
    occurredAt: e.occurredAt,
    label: e.label,
    amountEur: e.amountEur,
    assetSymbol: e.assetId ? (assetSymbol.get(e.assetId) ?? null) : null,
    quantity: e.quantity,
    description: e.description,
  }));

  const nextHref = ledger.nextCursor
    ? `/accounts/${accountId}?cursor=${encodeURIComponent(ledger.nextCursor)}`
    : null;
  const prevHref = cursor ? `/accounts/${accountId}` : null;

  const perfData = balances.map((b) => ({
    date: b.balanceDate,
    balanceEur: b.balanceEur,
  }));

  return (
    <div className="flex flex-col gap-6 p-8">
      <AccountHeader
        account={account}
        holdingsCount={positions.length}
        totalValueEur={totalValueEur}
      />

      <AccountPositionsTable rows={positions} />

      <Card title="Performance">
        {perfData.length === 0 ? (
          <StatesBlock
            mode="empty"
            title="No performance data"
            description="Daily balances will appear here once the nightly snapshot runs."
          />
        ) : (
          <AccountPerformanceChart data={perfData} />
        )}
      </Card>

      <AccountLedger rows={ledgerRows} nextHref={nextHref} prevHref={prevHref} />
    </div>
  );
}
