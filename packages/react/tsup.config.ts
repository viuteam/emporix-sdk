import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    provider: "src/provider.tsx",
    hooks: "src/hooks/index.ts",
    storage: "src/storage/index.ts",
    ssr: "src/ssr.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom", "@tanstack/react-query", "@viu/emporix-sdk"],
});
