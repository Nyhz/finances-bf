import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { DB } from "../../db/client";
import {
  clearFx,
  makeDb,
  resolveFxRangeStub,
  seedPriceHistory,
} from "./_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../lib/fx-backfill", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/fx-backfill")>(
      "../../lib/fx-backfill",
    );
  return { ...actual, resolveFxRange: resolveFxRangeStub };
});

import { createAccount } from "../../actions/accounts";
import { createAsset } from "../../actions/createAsset";
import { confirmImport } from "../../actions/confirmImport";

// CoBaS CSV — subscriptions, partial reembolso, management fees.
const CSV = `Fecha,Operación,Fondo,ISIN,Participaciones,Valor liquidativo,Importe,Divisa
2026-01-10,Suscripción,Cobas Selección FI,ES0119199000,15.234,98.45,1500.00,EUR
2026-02-05,Suscripción,Cobas Internacional FI,ES0119184002,8.110,123.30,1000.00,EUR
2026-03-15,Reembolso,Cobas Internacional FI,ES0119184002,5.000,128.10,640.50,EUR
`;

describe("e2e — CoBaS import (funds / ISIN-first)", () => {
  let db: DB;
  let accountId: string;

  beforeEach(async () => {
    db = makeDb();
    clearFx();

    const acc = await createAccount(
      {
        name: "COBAS",
        accountType: "investment",
        currency: "EUR",
        openingBalanceNative: 0,
      },
      db,
    );
    if (!acc.ok) throw new Error("account");
    accountId = acc.data.id;

    await createAsset(
      {
        name: "Cobas Selección FI",
        assetType: "fund",
        isin: "ES0119199000",
        currency: "EUR",
      },
      db,
    );
    await createAsset(
      {
        name: "Cobas Internacional FI",
        assetType: "fund",
        isin: "ES0119184002",
        currency: "EUR",
      },
      db,
    );
    seedPriceHistory(db, "ES0119199000", "2026-01-10", "2026-04-22", 100);
    seedPriceHistory(db, "ES0119184002", "2026-02-05", "2026-04-22", 130);
  });

  it("imports subscriptions and a partial reembolso, opens lots, consumes FIFO", async () => {
    const res = await confirmImport(
      { source: "cobas", accountId, csvText: CSV },
      db,
    );
    if (!res.ok) throw new Error(res.error.message);

    const trades = db.select().from(schema.assetTransactions).all();
    const buys = trades.filter((t) => t.transactionType === "buy");
    const sells = trades.filter((t) => t.transactionType === "sell");
    expect(buys).toHaveLength(2);
    expect(sells).toHaveLength(1);

    // Selección: fully held.
    const seleccion = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.isin, "ES0119199000"))
      .get();
    const seleccionPos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, seleccion!.id))
      .get();
    expect(seleccionPos?.quantity).toBeCloseTo(15.234, 4);

    // Internacional: 8.11 bought, 5.0 reembolsado → 3.11 remaining.
    const internacional = db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.isin, "ES0119184002"))
      .get();
    const interPos = db
      .select()
      .from(schema.assetPositions)
      .where(eq(schema.assetPositions.assetId, internacional!.id))
      .get();
    expect(interPos?.quantity).toBeCloseTo(3.11, 4);

    // FIFO consumption on Internacional reembolso: 5 participaciones @ avg cost
    //   avg_cost_nv = 1000 / 8.11 ≈ 123.30 → consumed cost ≈ 616.52
    const consumptions = db
      .select()
      .from(schema.taxLotConsumptions)
      .all();
    expect(consumptions).toHaveLength(1);
    expect(consumptions[0].qtyConsumed).toBeCloseTo(5, 4);
    expect(consumptions[0].costBasisEur).toBeCloseTo(616.52, 1);
  });
});
