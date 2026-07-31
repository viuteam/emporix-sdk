import { defineConfig } from "tsup";

export default defineConfig({
  // `webhook` is its own entry so a Route Handler does not pull the client and
  // session code (and with it `next/headers`).
  entry: { index: "src/index.ts", webhook: "src/webhook.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["next", "@viu/emporix-sdk", "@viu/emporix-sdk-react"],
});
