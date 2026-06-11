// Mapas de etiquetas de visualización compartidos. Los valores almacenados
// (enums de la DB) permanecen en inglés — aquí solo se traduce la UI.
// Client-safe: sin imports de servidor.

import type { AccountType } from "@/src/lib/domain";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  broker: "Bróker",
  crypto: "Cripto",
  investment: "Inversión",
  savings: "Ahorro",
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type as AccountType] ?? type;
}

/** Cubre todos los CASH_MOVEMENT_KINDS más el "trade" derivado del ledger. */
export const CASH_MOVEMENT_LABELS: Record<string, string> = {
  deposit: "Ingreso",
  withdrawal: "Retirada",
  interest: "Intereses",
  fee: "Comisión",
  dividend: "Dividendo",
  trade: "Operación",
  "transfer-in": "Transferencia recibida",
  "transfer-out": "Transferencia enviada",
};

export function cashMovementLabel(kind: string): string {
  return CASH_MOVEMENT_LABELS[kind] ?? kind;
}

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  buy: "Compra",
  sell: "Venta",
  dividend: "Dividendo",
};

export function transactionTypeLabel(type: string): string {
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}

/** Etiqueta para filas de ledger mixto (transacciones + movimientos de efectivo). */
export function ledgerLabel(label: string): string {
  return TRANSACTION_TYPE_LABELS[label] ?? CASH_MOVEMENT_LABELS[label] ?? label;
}
