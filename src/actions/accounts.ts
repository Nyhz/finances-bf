"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, lte } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { db as defaultDb, type DB } from "../db/client";
import { accounts, auditEvents, fxRates, type Account } from "../db/schema";
import { toIsoDate } from "../lib/fx";

const ACTOR = "commander";

const ACCOUNT_TYPES = ["broker", "bank", "crypto", "cash", "other"] as const;

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(ACCOUNT_TYPES).default("other"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code")
    .default("EUR"),
  openingBalanceNative: z
    .number()
    .finite()
    .min(0, "Opening balance must be zero or positive")
    .default(0),
  notes: z.string().trim().max(500).optional(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;

export type ActionError = {
  code: "validation" | "db";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

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
        message: "Invalid input",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      },
    };
  }

  const { name, accountType, currency, openingBalanceNative, notes } = parsed.data;
  const today = toIsoDate(new Date());

  try {
    const inserted = db.transaction((tx) => {
      let rate = 1;
      let fxSource: "unit" | "historical" | "latest" = "unit";
      if (currency !== "EUR") {
        const onDate = tx
          .select()
          .from(fxRates)
          .where(and(eq(fxRates.currency, currency), eq(fxRates.date, today)))
          .get();
        if (onDate) {
          rate = onDate.rateToEur;
          fxSource = "historical";
        } else {
          const latest = tx
            .select()
            .from(fxRates)
            .where(and(eq(fxRates.currency, currency), lte(fxRates.date, today)))
            .orderBy(desc(fxRates.date))
            .get();
          if (!latest) {
            throw new Error(`No FX rate available for ${currency} on ${today}`);
          }
          rate = latest.rateToEur;
          fxSource = "latest";
        }
      }

      const openingBalanceEur = roundMoney(openingBalanceNative * rate);
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
          currentCashBalanceEur: openingBalanceEur,
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
            fxSource,
          }),
          createdAt: now,
        })
        .run();

      return row;
    });

    revalidatePath("/accounts");
    revalidatePath("/");

    return { ok: true, data: inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown DB error";
    return { ok: false, error: { code: "db", message } };
  }
}
