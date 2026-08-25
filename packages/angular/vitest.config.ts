import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Test-only: resolve the package to sdk source so tests need no prebuild.
      // Shipped code still imports the package name.
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      // https origin so Secure cookies persist; node export conditions so MSW v2
      // and undici share one AbortSignal/fetch realm.
      jsdom: { url: "https://localhost/", customExportConditions: ["node"] },
    },
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/storage.ts", "src/ssr.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
