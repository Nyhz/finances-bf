"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { createAccount } from "@/src/actions/accounts";

type FormState = {
  name: string;
  accountType: string;
  currency: string;
  openingBalanceNative: string;
  notes: string;
};

const INITIAL: FormState = {
  name: "",
  accountType: "other",
  currency: "EUR",
  openingBalanceNative: "0",
  notes: "",
};

const ACCOUNT_TYPES = ["broker", "bank", "crypto", "cash", "other"] as const;

export function CreateAccountModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function reset() {
    setForm(INITIAL);
    setFieldErrors({});
    setBanner(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setFieldErrors({});

    const payload = {
      name: form.name,
      accountType: form.accountType,
      currency: form.currency.toUpperCase(),
      openingBalanceNative: Number(form.openingBalanceNative),
      notes: form.notes.trim() ? form.notes : undefined,
    };

    startTransition(async () => {
      const result = await createAccount(payload);
      if (result.ok) {
        reset();
        onOpenChange(false);
        return;
      }
      if (result.error.code === "validation" && result.error.fieldErrors) {
        setFieldErrors(result.error.fieldErrors);
      } else {
        setBanner(result.error.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) reset();
        onOpenChange(next);
      }}
      title="New account"
      description="Track a cash balance against a broker, bank, or wallet."
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

        <Field label="Name" errors={fieldErrors.name}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
            maxLength={80}
            required
          />
        </Field>

        <Field label="Type" errors={fieldErrors.accountType}>
          <select
            value={form.accountType}
            onChange={(e) => update("accountType", e.target.value)}
            className={inputClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency (ISO 4217)" errors={fieldErrors.currency}>
          <input
            type="text"
            value={form.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase())}
            className={inputClass}
            maxLength={3}
            required
          />
        </Field>

        <Field
          label={`Opening balance (${form.currency || "EUR"})`}
          errors={fieldErrors.openingBalanceNative}
        >
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.openingBalanceNative}
            onChange={(e) => update("openingBalanceNative", e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <Field label="Notes" errors={fieldErrors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={`${inputClass} min-h-[80px]`}
            maxLength={500}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
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
