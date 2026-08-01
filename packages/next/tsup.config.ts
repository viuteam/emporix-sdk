import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  external: ["next", "@viu/emporix-sdk", "@viu/emporix-sdk-react"],
};

export default defineConfig([
  {
    ...shared,
    // Each entry is separate for a reason. `webhook`: a Route Handler must not
    // pull the client and session code (and with it `next/headers`). `proxy`:
    // `cookies()` is not available in a proxy at all. `service` and `bff`: they
    // carry secrets, and their `exports` entries resolve to a throwing file
    // outside the server graph.
    entry: {
      index: "src/index.ts",
      webhook: "src/webhook.ts",
      proxy: "src/proxy.ts",
      service: "src/service.ts",
      bff: "src/bff.ts",
    },
    treeshake: true,
    // clean is handled by the build script — tsup's own clean runs mid-build and
    // would race-delete the other config's output.
    clean: false,
  },
  {
    ...shared,
    entry: { "catalog-client": "src/catalog-client.ts" },
    clean: false,
    // treeshake is intentionally omitted: tsup's rollup treeshake post-pass
    // rewrites each chunk and strips any prepended banner. Learned in
    // packages/react — see its tsup.config.ts.
    banner: { js: '"use client";' },
  },
]);
