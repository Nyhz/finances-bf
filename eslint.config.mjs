import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Tax-data provenance wall (audit T8): the tax engine must never read
    // market data. The single sanctioned exception is yearEnd.ts (Modelo 720
    // declares market value by legal definition) — see SPEC §6.
    files: ["src/server/tax/**/*.ts"],
    ignores: ["src/server/tax/yearEnd.ts", "src/server/tax/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/pricing", "**/lib/pricing/**"],
              message:
                "Tax code must not touch market-data clients. If this is for year-end balances, it belongs in yearEnd.ts.",
            },
            {
              group: ["**/db/schema", "**/db/schema/**"],
              importNamePattern: "^(assetValuations|priceHistory|fxRates)$",
              message:
                "Tax code must not read market tables (asset_valuations / price_history / fx_rates). Year-end valuation reads live in yearEnd.ts only.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
