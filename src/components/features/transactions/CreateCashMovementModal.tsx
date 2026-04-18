"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createCashMovement } from "@/src/actions/createCashMovement";

const MANUAL_CASH_MOVEMENT_KINDS = ["deposit", "withdrawal", "interest"] as const;
type ManualCashMovementKind = (typeof MANUAL_CASH_MOVEMENT_KINDS)[number];

export type CashAccountOption = {
  id: string;
  name: string;
  currency: string;
  accountType: string;
};

type FormState = {
  accountId: string;
  kind: ManualCashMovementKind;
  occurredAt: string;
  amount: string;
  currency: string;
  fxRateToEur: string;
  description: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function labelForKind(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function CreateCashMovementModal({
  open,
  onOpenChange,
  accounts,
  defaultAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: CashAccountOption[];
  defaultAccountId?: string;
}) {
  const initial = React.useMemo<FormState>(() => {
    const fallback = accounts[0];
    const picked =
      (defaultAccountId && accounts.find((a) => a.id === defaultAccountId)) ||
      fallback;
    return {
      accountId: picked?.id ?? "",
      kind: "deposit",
      occurredAt: todayIso(),
      amount: "",
      currency: picked?.currency ?? "EUR",
      fxRateToEur: "",
      description: "",
    };
  }, [accounts, defaultAccountId]);

  const [form, setForm] = React.useState<FormState>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleOpenChange(next: boolean) {
    if (!next && !pending) {
      setForm(initial);
      setFieldErrors({});
      setBanner(null);
    }
    onOpenChange(next);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onAccountChange(id: string) {
    const next = accounts.find((a) => a.id === id);
    setForm((prev) => ({
      ...prev,
      accountId: id,
      currency: next?.currency ?? prev.currency,
    }));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const fxRate = form.fxRateToEur.trim();
    const payload = {
      accountId: form.accountId,
      kind: form.kind,
      occurredAt: form.occurredAt,
      amountNative: Number(form.amount),
      currency: form.currency.toUpperCase(),
      fxRateToEur: fxRate ? Number(fxRate) : undefined,
      description: form.description.trim() ? form.description : undefined,
    };

    startTransition(async () => {
      const result = await createCashMovement(payload);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  const signHint =
    form.kind === "withdrawal"
      ? "Amount is signed as a debit (balance decreases)."
      : "Amount is signed as a credit (balance increases).";

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="New cash movement"
      description="Deposits, withdrawals, interest, fees, dividends and transfers."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {banner && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {banner}
          </div>
        )}

        <Field label="Account" errors={fieldErrors.accountId}>
          <select
            value={form.accountId}
            onChange={(e) => onAccountChange(e.target.value)}
            className={inputClass}
            required
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Kind" errors={fieldErrors.kind}>
          <select
            value={form.kind}
            onChange={(e) =>
              update("kind", e.target.value as FormState["kind"])
            }
            className={inputClass}
          >
            {MANUAL_CASH_MOVEMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {labelForKind(k)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{signHint}</span>
        </Field>

        <Field label="Date" errors={fieldErrors.occurredAt}>
          <input
            type="date"
            value={form.occurredAt}
            onChange={(e) => update("occurredAt", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" errors={fieldErrors.amountNative}>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Currency" errors={fieldErrors.currency}>
            <input
              type="text"
              value={form.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
              className={inputClass}
              maxLength={3}
              required
            />
          </Field>
        </div>

        <Field
          label="FX rate to EUR (optional)"
          errors={fieldErrors.fxRateToEur}
        >
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={form.fxRateToEur}
            onChange={(e) => update("fxRateToEur", e.target.value)}
            className={inputClass}
            placeholder="Leave blank to use the stored rate"
          />
        </Field>

        <Field label="Description" errors={fieldErrors.description}>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className={`${inputClass} min-h-[60px]`}
            maxLength={500}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !form.accountId}>
            {pending ? "Saving…" : "Create movement"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";

function Field({
  label,
  errors,
  children,
}: {
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {errors && errors.length > 0 && (
        <span className="text-xs text-destructive">{errors.join(", ")}</span>
      )}
    </label>
  );
}
