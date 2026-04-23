"use client";

import * as React from "react";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { updateAsset } from "@/src/actions/updateAsset";
import { ASSET_TYPES } from "@/src/actions/_constants";
import type { Asset } from "@/src/db/schema";

type FormState = {
  name: string;
  symbol: string;
  isin: string;
  assetType: string;
  exchange: string;
  providerSymbol: string;
  isActive: boolean;
};

function stateFromAsset(a: Asset): FormState {
  return {
    name: a.name,
    symbol: a.symbol ?? "",
    isin: a.isin ?? "",
    assetType: a.assetType,
    exchange: a.exchange ?? "",
    providerSymbol: a.providerSymbol ?? "",
    isActive: a.isActive,
  };
}

export function EditAssetModal({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = React.useState<FormState | null>(() =>
    asset ? stateFromAsset(asset) : null,
  );
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [banner, setBanner] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (!asset || !form) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form || !asset) return;
    setBanner(null);
    setFieldErrors({});

    const payload = {
      id: asset.id,
      name: form.name,
      symbol: form.symbol,
      isin: form.isin.trim() ? form.isin.trim() : null,
      assetType: form.assetType,
      exchange: form.exchange.trim() ? form.exchange.trim() : null,
      providerSymbol: form.providerSymbol.trim() ? form.providerSymbol.trim() : null,
      isActive: form.isActive,
    };

    startTransition(async () => {
      const result = await updateAsset(payload);
      if (result.ok) {
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
      onOpenChange={onOpenChange}
      title="Edit asset"
      description={asset.name}
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
            maxLength={120}
            required
          />
        </Field>

        <Field label="Symbol" errors={fieldErrors.symbol}>
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => update("symbol", e.target.value)}
            className={inputClass}
            maxLength={32}
            required
          />
        </Field>

        <Field label="ISIN" errors={fieldErrors.isin}>
          <input
            type="text"
            value={form.isin}
            onChange={(e) => update("isin", e.target.value.toUpperCase())}
            className={inputClass}
            maxLength={12}
          />
        </Field>

        <Field label="Type" errors={fieldErrors.assetType}>
          <select
            value={form.assetType}
            onChange={(e) => update("assetType", e.target.value)}
            className={inputClass}
          >
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Exchange" errors={fieldErrors.exchange}>
          <input
            type="text"
            value={form.exchange}
            onChange={(e) => update("exchange", e.target.value)}
            className={inputClass}
            maxLength={32}
          />
        </Field>

        <Field
          label="Provider symbol"
          errors={fieldErrors.providerSymbol}
        >
          <input
            type="text"
            value={form.providerSymbol}
            onChange={(e) => update("providerSymbol", e.target.value)}
            className={inputClass}
            maxLength={64}
            placeholder={
              form.assetType === "crypto"
                ? "CoinGecko coin id (e.g. binancecoin, ethereum)"
                : "Yahoo ticker (e.g. AAPL, BTC-EUR)"
            }
          />
          <span className="text-xs text-muted-foreground">
            {form.assetType === "crypto"
              ? "CoinGecko coin id used by the crypto price sync."
              : "Yahoo Finance ticker used by the daily price sync."}
          </span>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update("isActive", e.target.checked)}
          />
          <span>Active</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
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
