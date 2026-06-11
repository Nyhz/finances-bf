"use server";

import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, auditEvents, type Account } from "../db/schema";
import { FxUnavailableError, resolveFxRateSync } from "../lib/fx";
import { toIsoDate } from "../lib/time";
import { roundEur } from "../lib/money";
import { dbFxLookup } from "./_fx";

import {
  ACCOUNT_TYPES,
  ACTOR,
  isCashBearingAccount,
  revalidateAccountMutation,
  type ActionResult,
} from "./_shared";

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(ACCOUNT_TYPES).default("savings"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "La divisa debe ser un código ISO 4217 de 3 letras")
    .default("EUR"),
  openingBalanceNative: z
    .number()
    .finite()
    .min(0, "El saldo inicial debe ser cero o positivo")
    .default(0),
  notes: z.string().trim().max(500).optional(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;

export async function createAccount(
  input: unknown,
  db: DB = defaultDb,
): Promise<ActionResult<Account>> {
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Datos no válidos",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { name, accountType, currency, openingBalanceNative, notes } = parsed.data;
  const today = toIsoDate(new Date());

  try {
    const inserted = db.transaction((tx) => {
      // Opening balances are estimates, so the stored daily rate is fine
      // here (no manual-FX requirement) — but resolution still goes through
      // src/lib/fx.ts, never an ad-hoc lookup. A stale fallback is recorded
      // as such in the audit context instead of silently passing.
      const fx = resolveFxRateSync(currency, today, dbFxLookup(tx));
      const rate = fx.rate;

      const openingBalanceEur = roundEur(openingBalanceNative * rate);
      const now = Date.now();
      const id = ulid();

      tx
        .insert(accounts)
        .values({
          id,
          name,
          currency,
          accountType,
          openingBalanceEur,
          currentCashBalanceEur: isCashBearingAccount(accountType) ? openingBalanceEur : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = tx.select().from(accounts).where(eq(accounts.id, id)).get();
      if (!row) {
        throw new Error("account insert vanished");
      }

      tx
        .insert(auditEvents)
        .values({
          id: ulid(),
          entityType: "account",
          entityId: id,
          action: "create",
          actorType: "user",
          source: "ui",
          summary: notes ?? null,
          previousJson: null,
          nextJson: JSON.stringify(row),
          contextJson: JSON.stringify({
            actor: ACTOR,
            openingBalanceNative,
            currency,
            fxRateToEur: rate,
            fxSource: fx.source,
            fxStale: fx.stale ?? false,
          }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidateAccountMutation();

    return { ok: true, data: inserted };
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return {
        ok: false,
        error: {
          code: "db",
          message: `No hay tipo de cambio disponible para ${currency} a fecha ${today}`,
        },
      };
    }
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
