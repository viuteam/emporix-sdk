import { createRequire } from "node:module";
import { dirname } from "node:path";

// esbuild is not a direct dependency, but `tsup` (our bundler, a devDep) pulls
// it in. Resolve esbuild from tsup's install location so this script needs no
// extra dependency.
const require = createRequire(import.meta.url);
const tsupDir = dirname(require.resolve("tsup"));
const esbuildEntry = require.resolve("esbuild", { paths: [tsupDir] });
const { build } = await import(esbuildEntry);

// Fixture: a factory consumer that uses only products + carts.
const fixture = `
  import { createEmporixClient, ProductService, CartService } from "../dist/index.js";
  const c = createEmporixClient(
    { tenant: "t", credentials: { storefront: { clientId: "x" } }, logger: false },
    { products: ProductService, carts: CartService },
  );
  globalThis.__c = c;
`;

const result = await build({
  stdin: { contents: fixture, resolveDir: import.meta.dirname, loader: "js" },
  bundle: true,
  minify: true,
  format: "esm",
  treeShaking: true,
  write: false,
  logLevel: "silent",
});
const out = result.outputFiles[0].text;

// Unique markers that appear ONLY in services NOT pulled by products/carts.
// If the factory tree-shakes, none may survive.
const forbidden = ["sepa-export", "reward-points", "/webhooks", "pick-pack", "ai-rag-indexer"];
const leaked = forbidden.filter((m) => out.includes(m));
if (leaked.length > 0) {
  console.error(`tree-shaking FAILED — unused service markers in bundle: ${leaked.join(", ")}`);
  process.exit(1);
}
// Sanity: the services we DID import must be present.
for (const m of ["/products/", "/carts"]) {
  if (!out.includes(m)) {
    console.error(`tree-shaking probe broken — expected marker "${m}" missing`);
    process.exit(1);
  }
}
console.log(
  `createEmporixClient tree-shakes: none of [${forbidden.join(", ")}] in the bundle (${(out.length / 1024).toFixed(1)} KB)`,
);
