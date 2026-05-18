import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/index.ts",
        "src/generated/**",
        // Pure re-export barrels for subpath exports — no logic to cover.
        "src/customer.ts",
        "src/product.ts",
        "src/category.ts",
        "src/cart.ts",
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
