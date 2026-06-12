import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  external: ["react", "react-dom", "@tanstack/react-query", "@viu/emporix-sdk"],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      provider: "src/provider.tsx",
      hooks: "src/hooks/index.ts",
      storage: "src/storage/index.ts",
    },
    // clean is handled by the build script ("rm -rf dist && tsup") — tsup's
    // own clean:true runs cleanDtsFiles mid-build and would race-delete the
    // ssr config's already-written d.ts output (the two configs run in parallel).
    clean: false,
    // treeshake is intentionally omitted for client entries: tsup's rollup
    // treeshake post-pass rewrites each chunk and strips any prepended banner.
    // Consumer bundlers (Next.js / Vite) tree-shake the published ESM anyway.
    // RSC boundary marker: these entries evaluate createContext/hooks at
    // module scope and must load as Client Components under the Next.js App
    // Router. esbuild drops "use client" from bundled sources — the banner
    // re-adds it to every emitted file of this build.
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    entry: { ssr: "src/ssr.ts" },
    treeshake: true,
    // NO banner: ssr.ts must stay importable from Server Components.
    // clean stays false for the same reason as above.
    clean: false,
  },
]);
