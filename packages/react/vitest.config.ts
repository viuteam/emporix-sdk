import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Test-only: resolve the package to sdk source so tests need no prebuild.
      // Shipped code still imports the package name (see plan header).
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // https origin so Secure cookies persist; node export conditions so MSW v2 +
    // undici share one AbortSignal/fetch realm (avoids "instance of AbortSignal").
    environmentOptions: {
      jsdom: { url: "https://localhost/", customExportConditions: ["node"] },
    },
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/hooks/index.ts", "src/storage/index.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
