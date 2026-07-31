import { defineConfig } from "tsup";

export default defineConfig({
  // `webhook` is added in the webhook task; keeping it out until src/webhook.ts
  // exists so the build stays green in between.
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["next", "@viu/emporix-sdk", "@viu/emporix-sdk-react"],
});
