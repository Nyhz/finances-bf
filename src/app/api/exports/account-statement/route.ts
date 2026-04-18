import { getAccount } from "@/src/server/accounts";
import { getLedgerForAccount } from "@/src/server/transactions";
import { buildAccountStatementPdf } from "@/src/lib/pdf/account-statement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isNaN(t) ? fallback : t;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) {
    return Response.json({ error: "accountId required" }, { status: 400 });
  }

  const account = await getAccount(accountId);
  if (!account) {
    return Response.json({ error: "account not found" }, { status: 404 });
  }

  const now = Date.now();
  const from = parseDate(url.searchParams.get("from"), now - 1000 * 60 * 60 * 24 * 365);
  const to = parseDate(url.searchParams.get("to"), now);

  const rows: Array<{
    occurredAt: number;
    label: string;
    amountEur: number;
    description: string | null;
  }> = [];
  let cursor: string | undefined;
  do {
    const page = await getLedgerForAccount(accountId, { cursor, limit: 200 });
    for (const e of page.items) {
      if (e.occurredAt < from || e.occurredAt > to) continue;
      rows.push({
        occurredAt: e.occurredAt,
        label: e.label,
        amountEur: e.amountEur,
        description: e.description ?? null,
      });
    }
    cursor = page.nextCursor ?? undefined;
    // Stop early if page oldest is before range.
    const oldest = page.items[page.items.length - 1];
    if (oldest && oldest.occurredAt < from) break;
  } while (cursor);

  rows.sort((a, b) => b.occurredAt - a.occurredAt);

  const bytes = buildAccountStatementPdf({
    account: {
      id: account.id,
      name: account.name,
      accountType: account.accountType,
      currency: account.currency,
      currentCashBalanceEur: account.currentCashBalanceEur,
    },
    from,
    to,
    rows,
  });

  const filename = `statement-${account.name.replace(/[^a-z0-9]+/gi, "-")}-${new Date(from).toISOString().slice(0, 10)}_${new Date(to).toISOString().slice(0, 10)}.pdf`;

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
