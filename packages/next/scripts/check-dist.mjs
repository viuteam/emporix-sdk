// Guards the RSC boundary contract of the published package:
// - catalog-client MUST start with "use client" (esbuild drops source
//   directives; tsup must re-add them via `banner`).
// - the server entries MUST stay directive-free.
import { readFileSync, existsSync } from "node:fs";

const HEAD_BYTES = 200;
const mustHaveBanner = ["catalog-client"];
const mustNotHaveBanner = ["index", "webhook", "proxy", "service", "bff"];
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
for (const name of [...mustHaveBanner, ...mustNotHaveBanner]) {
  for (const ext of ["d.ts", "d.cts"]) {
    if (!existsSync(new URL(`../dist/${name}.${ext}`, import.meta.url))) {
      console.error(`FAIL dist/${name}.${ext}: missing declaration file`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('dist "use client" banners OK');
