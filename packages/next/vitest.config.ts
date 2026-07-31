import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Test-only: resolve the workspace packages to source so tests need no
      // prebuild. Shipped code still imports the package names.
      // Order matters — the more specific subpath must come first, or the
      // shorter prefix wins.
      "@viu/emporix-sdk-react/ssr": fileURLToPath(
        new URL("../react/src/ssr.ts", import.meta.url),
      ),
      "@viu/emporix-sdk-react": fileURLToPath(
        new URL("../react/src/index.ts", import.meta.url),
      ),
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
