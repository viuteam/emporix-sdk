import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    storage: "src/storage.ts",
    ssr: "src/ssr.ts",
  },
  // ESM only. @angular/core publishes no `main` and the TanStack Angular
  // adapter is ESM-only; Angular applications always bundle. A CJS half would
  // exist for no consumer.
  format: ["esm"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: false,
  external: [
    "@angular/core",
    "@angular/common",
    "@tanstack/angular-query-experimental",
    "@viu/emporix-sdk",
  ],
});
