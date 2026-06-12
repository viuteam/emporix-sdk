// Guards the RSC boundary contract of the published package:
// - client entries (index/provider/hooks/storage) MUST start with "use client"
//   (esbuild drops source directives; tsup must re-add them via `banner`).
// - the ssr entry MUST stay directive-free so it remains importable from
//   React Server Components.
import { readFileSync, existsSync } from "node:fs";

const HEAD_BYTES = 200;
const mustHaveBanner = ["index", "provider", "hooks", "storage"];
const mustNotHaveBanner = ["ssr"];
let failed = false;

const head = (name, ext) =>
  readFileSync(new URL(`../dist/${name}.${ext}`, import.meta.url), "utf8").slice(0, HEAD_BYTES);

for (const name of mustHaveBanner) {
  for (const ext of ["js", "cjs"]) {
    if (!head(name, ext).includes('"use client"')) {
      console.error(`FAIL dist/${name}.${ext}: missing "use client" banner`);
      failed = true;
    }
  }
}
for (const name of mustNotHaveBanner) {
  for (const ext of ["js", "cjs"]) {
    if (head(name, ext).includes('"use client"')) {
      console.error(`FAIL dist/${name}.${ext}: must NOT carry "use client" (server entry)`);
      failed = true;
    }
  }
}

// The split tsup config builds client and ssr entries in parallel; a clean
// pass in either config can race-delete the other's declarations. Assert
// every entry ships its types.
const allEntries = [...mustHaveBanner, ...mustNotHaveBanner];
for (const name of allEntries) {
  for (const ext of ["d.ts", "d.cts"]) {
    if (!existsSync(new URL(`../dist/${name}.${ext}`, import.meta.url))) {
      console.error(`FAIL dist/${name}.${ext}: missing declaration file`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('dist "use client" banners OK');
