import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages serves `404.html` for any unknown path. Copying the built
 * `index.html` to `404.html` lets the client-side router handle deep links
 * (e.g. /product/123) instead of showing a hard 404.
 */
function spaFallback404(): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "spa-fallback-404",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
      root = cfg.root;
    },
    closeBundle() {
      const dir = resolve(root, outDir);
      copyFileSync(resolve(dir, "index.html"), resolve(dir, "404.html"));
    },
  };
}

// `base` is `/` for local dev/build and `/emporix-sdk/` on GitHub Pages
// (set via VITE_BASE in the Pages workflow). A custom domain would set
// VITE_BASE=/ and add a CNAME.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), spaFallback404()],
});
