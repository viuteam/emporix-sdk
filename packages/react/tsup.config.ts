import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/provider.tsx",
    "src/hooks/index.ts",
    "src/storage/index.ts",
    "src/ssr.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom", "@tanstack/react-query", "@viu/emporix-sdk"],
});
