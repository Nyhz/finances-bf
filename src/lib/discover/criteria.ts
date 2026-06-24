// The Discover "baremos": each criterion is both a discovery hint (fed to the
// Claude agent so it knows what to hunt for) and a deterministic verifier (turns
// the candidate's real price history into a confirmed/refuted/unverifiable
// verdict + a human-readable hard number for the card). Adding a new screen =
// one entry here.

export const DISCOVER_CRITERIA_KEYS = [
  "below_dma200",
  "drawdown_30d",
  "momentum_no_highs",
  "hot_sector_laggard",
] as const;
export type DiscoverCriterionKey = (typeof DISCOVER_CRITERIA_KEYS)[number];

// Verified metrics computed from real price history (see verify.ts). Any field
// may be null when data is missing; the criterion decides if that makes it
// unverifiable.
export type DiscoverMetrics = {
  price: number | null;
  currency: string | null;
  dma200: number | null;
  pctVsDma200: number | null; // fraction, negative when below the average
  drawdown30d: number | null; // fraction, negative
  momentum20d: number | null; // fraction
  pctBelow52wHigh: number | null; // fraction, negative
  sector: string | null;
  sectorStrength3m: number | null; // sector ETF 3-month return, fraction
  ownReturn3m: number | null; // candidate's own 3-month return, fraction
};

export type CriterionVerdict = {
  status: "confirmed" | "refuted" | "unverifiable";
  detail: string;
};

// Thresholds — tuned for "interesting but not extreme". Centralised so they're
// easy to adjust.
export const THRESHOLDS = {
  drawdown30dMin: 0.15, // ≥15% off the 30-day high
  momentum20dMin: 0.05, // ≥+5% over 20 sessions
  below52wMin: 0.1, // still ≥10% below the 52-week high
  sectorStrengthMin: 0.1, // sector ETF ≥+10% over 3 months
  ownLagMax: 0.02, // the stock itself ≤+2% over 3 months (lagging)
} as const;

function pct(x: number | null): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
function pctSigned(x: number | null): string {
  if (x == null) return "—";
  const s = x > 0 ? "+" : "";
  return `${s}${(x * 100).toFixed(1)}%`;
}

export type DiscoverCriterion = {
  key: DiscoverCriterionKey;
  label: string;
  /** Steers the agent's web hunt for this baremo. */
  promptHint: string;
  /** Deterministic verdict from real metrics. */
  verify: (m: DiscoverMetrics) => CriterionVerdict;
};

export const DISCOVER_CRITERIA: DiscoverCriterion[] = [
  {
    key: "below_dma200",
    label: "Bajo la DMA200",
    promptHint:
      "Acciones de calidad que cotizan por DEBAJO de su media móvil de 200 sesiones (posible sobreventa / valor).",
    verify: (m) => {
      if (m.price == null || m.dma200 == null) {
        return { status: "unverifiable", detail: "Sin histórico suficiente para la DMA200" };
      }
      const detail = `Precio ${m.price} vs DMA200 ${m.dma200} (${pctSigned(m.pctVsDma200)})`;
      return { status: m.price < m.dma200 ? "confirmed" : "refuted", detail };
    },
  },
  {
    key: "drawdown_30d",
    label: "Caída 30d",
    promptHint:
      "Acciones que han CAÍDO con fuerza (≈15% o más) desde su máximo de los últimos 30 días, sin deterioro estructural del negocio.",
    verify: (m) => {
      if (m.drawdown30d == null) {
        return { status: "unverifiable", detail: "Sin histórico de 30 días" };
      }
      const detail = `${pct(m.drawdown30d)} desde el máximo de 30d`;
      return {
        status: m.drawdown30d <= -THRESHOLDS.drawdown30dMin ? "confirmed" : "refuted",
        detail,
      };
    },
  },
  {
    key: "momentum_no_highs",
    label: "Momentum sin máximos",
    promptHint:
      "Acciones con momentum reciente al alza (subiendo las últimas semanas) pero que AÚN NO han recuperado sus máximos previos de 52 semanas.",
    verify: (m) => {
      if (m.momentum20d == null || m.pctBelow52wHigh == null) {
        return { status: "unverifiable", detail: "Sin histórico de 52 semanas" };
      }
      const detail = `Momentum 20d ${pctSigned(m.momentum20d)}, aún ${pct(m.pctBelow52wHigh)} bajo máx. 52s`;
      const ok =
        m.momentum20d >= THRESHOLDS.momentum20dMin &&
        m.pctBelow52wHigh <= -THRESHOLDS.below52wMin;
      return { status: ok ? "confirmed" : "refuted", detail };
    },
  },
  {
    key: "hot_sector_laggard",
    label: "Sector en alza, rezagada",
    promptHint:
      "Acciones de un sector que está MUY FUERTE últimamente (el sector sube con claridad) pero que ellas mismas aún no han despegado (siguen planas o en negativo).",
    verify: (m) => {
      if (m.sectorStrength3m == null || m.ownReturn3m == null) {
        return { status: "unverifiable", detail: "Sin datos de sector/retorno a 3 meses" };
      }
      const detail = `Sector ${m.sector ?? "?"} ${pctSigned(m.sectorStrength3m)} 3m vs acción ${pctSigned(m.ownReturn3m)}`;
      const ok =
        m.sectorStrength3m >= THRESHOLDS.sectorStrengthMin &&
        m.ownReturn3m <= THRESHOLDS.ownLagMax;
      return { status: ok ? "confirmed" : "refuted", detail };
    },
  },
];

export function criterionByKey(key: string): DiscoverCriterion | undefined {
  return DISCOVER_CRITERIA.find((c) => c.key === key);
}

// Yahoo `sectorKey` (normalized, see src/lib/sectors.ts) → US sector SPDR ETF,
// used to gauge "sector strength" for the laggard screen. Unmapped sectors make
// that criterion unverifiable rather than guessing.
export const SECTOR_ETF: Record<string, string> = {
  technology: "XLK",
  "financial-services": "XLF",
  "healthcare": "XLV",
  "consumer-cyclical": "XLY",
  "consumer-defensive": "XLP",
  "communication-services": "XLC",
  energy: "XLE",
  industrials: "XLI",
  utilities: "XLU",
  "real-estate": "XLRE",
  "basic-materials": "XLB",
};
