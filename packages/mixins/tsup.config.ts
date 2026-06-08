import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", codegen: "src/codegen.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["@viu/emporix-sdk", "ajv", "json-schema-to-typescript", "jiti"],
});
