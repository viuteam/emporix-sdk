import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/customer.ts",
    "src/product.ts",
    "src/category.ts",
    "src/cart.ts",
    "src/checkout.ts",
    "src/payment.ts",
    "src/price.ts",
    "src/media.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
