import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Separate from `vite.config.ts` on purpose: that one carries the Module
 * Federation plugin, whose `shared` handling rewrites React imports for the host.
 * Under test there is no host, and the rewrite breaks the renderer.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * Without this the run dies on `Cannot read properties of null (reading
     * 'useEffect')`.
     *
     * The workspace holds both React majors — this module pins 18.3 to match the
     * dashboard host, other packages are on 19 — and pnpm happily resolved
     * `@tanstack/react-query` against the 19 copy while `react-dom` stayed on 18.
     * `QueryClientProvider` then calls hooks on a React the renderer does not own.
     *
     * The same two-copy break the README warns about for federation, arriving
     * through the test runner instead. Deduping pins all three to this package's
     * own resolution.
     */
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    alias: {
      /**
       * Test-only, and both are required together.
       *
       * Resolving these to `dist` puts the SDK's fetch in a different realm from
       * MSW's interceptor, so every request escapes the mock and comes back as
       * `EmporixNetworkError`. Aliasing only the SDK is worse: the React package's
       * own copy would still come from `dist`, giving two `EmporixError` class
       * identities and breaking every `instanceof` across the boundary.
       *
       * `packages/react/vitest.config.ts` does the same for the same reason.
       */
      "@viu/emporix-sdk": fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      ),
      "@viu/emporix-sdk-react": fileURLToPath(
        new URL("../../packages/react/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    // Node export conditions so MSW v2 and undici share one fetch realm —
    // without it, an intercepted request fails on "instance of AbortSignal".
    environmentOptions: {
      jsdom: { url: "https://localhost/", customExportConditions: ["node"] },
    },
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
