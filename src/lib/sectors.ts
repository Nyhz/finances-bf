// Taxonomía de sectores (Morningstar, vía Yahoo `topHoldings.sectorWeightings`).
// Las claves almacenadas permanecen en inglés (como las devuelve el proveedor);
// aquí solo se traduce la UI. Client-safe: sin imports de servidor.

export const SECTOR_KEYS = [
  "technology",
  "financial_services",
  "healthcare",
  "consumer_cyclical",
  "communication_services",
  "industrials",
  "consumer_defensive",
  "energy",
  "basic_materials",
  "utilities",
  "realestate",
] as const;

export type SectorKey = (typeof SECTOR_KEYS)[number];

/** Categorías de cartera que no son sectores de renta variable. Conviven con
 *  los sectores en el mismo gráfico de composición. */
export const CRYPTO_CATEGORY = "crypto";
export const COMMODITIES_CATEGORY = "commodities";

/** `assets.subtype` value that flags a commodity ETP (e.g. physical gold) —
 *  routes the position to the commodities bucket instead of equity sectors. */
export const COMMODITY_SUBTYPE = "commodity";

/** Bucket residual: posiciones sin sector ni categoría (p. ej. la parte
 *  no-renta-variable de un fondo, o una acción sin sector en Yahoo). */
export const UNCLASSIFIED_SECTOR = "unclassified";

const SECTOR_LABELS: Record<SectorKey, string> = {
  technology: "Tecnología",
  financial_services: "Servicios financieros",
  healthcare: "Salud",
  consumer_cyclical: "Consumo cíclico",
  communication_services: "Comunicaciones",
  industrials: "Industria",
  consumer_defensive: "Consumo defensivo",
  energy: "Energía",
  basic_materials: "Materiales básicos",
  utilities: "Servicios públicos",
  realestate: "Inmobiliario",
};

export function sectorLabel(key: string): string {
  if (key === UNCLASSIFIED_SECTOR) return "Sin clasificar";
  if (key === CRYPTO_CATEGORY) return "Cripto";
  if (key === COMMODITIES_CATEGORY) return "Oro / Materias primas";
  return SECTOR_LABELS[key as SectorKey] ?? key;
}

/** Normaliza una clave de sector de cualquier endpoint de Yahoo a las claves
 *  canónicas de `SECTOR_KEYS`. `assetProfile` usa guiones
 *  ("consumer-cyclical", "real-estate"); `topHoldings` usa guiones bajos. */
export function normalizeSectorKey(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "real_estate") return "realestate";
  return k;
}

/** Stable theme-tracked colour per sector. Each known sector maps to a fixed
 *  --chart-N variable so its colour is consistent across renders; the
 *  unclassified bucket uses a neutral muted tone. */
export function sectorColor(key: string): string {
  if (key === UNCLASSIFIED_SECTOR) return "hsl(var(--muted-foreground))";
  if (key === CRYPTO_CATEGORY) return "hsl(var(--chart-crypto))";
  if (key === COMMODITIES_CATEGORY) return "hsl(var(--chart-gold))";
  const idx = (SECTOR_KEYS as readonly string[]).indexOf(key);
  const n = idx >= 0 ? (idx % 10) + 1 : 10;
  return `hsl(var(--chart-${n}))`;
}
