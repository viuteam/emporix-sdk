// Guards the toolchain premise of this package.
//
// This package is built with tsup instead of ng-packagr because it exports only
// functions — no decorators, no templates — and therefore needs no Angular
// compiler. The premise was established by unpacking
// @tanstack/angular-query-experimental and finding zero compiler output in it.
// This is that same probe, kept as a regression test: the day someone adds an
// @Injectable() or a component, the build fails here rather than shipping an
// artifact that breaks in a consumer's AOT build.
//
// `import.meta.url` is fine here — plain Node script, not transformed by Vite.
import { readFileSync, readdirSync } from "node:fs";

const MARKERS = ["ɵɵngDeclare", "ɵprov", "ɵfac", "__decorate"];
const dist = new URL("../dist/", import.meta.url);
let failed = false;

const files = readdirSync(dist).filter((name) => name.endsWith(".js"));
// A guard that reads nothing passes vacuously. `dist/` must have been built.
if (files.length === 0) {
  console.error("FAIL dist/ has no .js files — run the build first");
  process.exit(1);
}

for (const name of files) {
  const source = readFileSync(new URL(name, dist), "utf8");
  for (const marker of MARKERS) {
    if (source.includes(marker)) {
      console.error(`FAIL dist/${name}: contains Angular compiler output "${marker}"`);
      console.error("  This package must stay decorator-free — see");
      console.error("  docs/superpowers/specs/2026-08-25-angular-package-design.md");
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  `dist is free of Angular compiler output (${files.length} files, ${MARKERS.length} markers)`,
);
