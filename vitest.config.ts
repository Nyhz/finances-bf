import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The real "server-only" package throws when imported outside a React
      // Server Component runtime. Action/server tests import those modules
      // directly, so the marker resolves to a no-op stub under vitest.
      "server-only": fileURLToPath(
        new URL("./src/__tests__/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
});
