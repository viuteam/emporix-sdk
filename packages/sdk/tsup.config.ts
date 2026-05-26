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
    "src/segment.ts",
    "src/companies.ts",
    "src/contacts.ts",
    "src/locations.ts",
    "src/customer-groups.ts",
    "src/orders.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
