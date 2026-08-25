import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryStorage, STORAGE_KEYS } from "../src/storage";

// `process.cwd()`, not `import.meta.url`: Vite transforms test modules, so
// `import.meta.url` is not a `file:` URL here and `readFileSync(new URL(...))`
// throws "The URL must be of scheme file". Plain Node scripts like
// `scripts/check-dist.mjs` are untransformed, which is why the URL form works
// there and not here. Vitest's root is this package directory.
const pkgRoot = process.cwd();

describe("the storage entry", () => {
  it("exposes a working memory backend", () => {
    const s = createMemoryStorage({ initial: "t1" });
    expect(s.getCustomerToken()).toBe("t1");
    s.setCustomerToken(null);
    expect(s.getCustomerToken()).toBeNull();
  });

  it("carries the same eight session keys as every other host", () => {
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(8);
    expect(STORAGE_KEYS.cartId).toBe("emporix.cartId");
  });
});

/**
 * The whole point of moving the agnostic layer into the SDK was that this
 * package needs it, not React. A stray `@viu/emporix-sdk-react` import would
 * still compile — it is a workspace package — and tsup does not treat it as
 * external, so it gets BUNDLED: the first build of this package shipped 67 KB
 * containing `require_react_production` because of exactly one such import.
 * That is what this test exists to prevent.
 */
describe("no dependency on the React bindings", () => {
  it("has no source file importing @viu/emporix-sdk-react", () => {
    const dir = join(pkgRoot, "src");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" });
    // Guard the probe itself: an empty or mis-rooted listing would make this
    // test pass while checking nothing.
    expect(files.filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(0);
    // Matches an actual import, not any mention. A plain substring check on the
    // package name flagged `ssr.ts` for referring to
    // `@viu/emporix-sdk-react/ssr` in a doc comment — pointing at the sibling
    // package in prose is legitimate and useful, and a guard that forbids it
    // would keep firing on documentation.
    const importsReact = /(?:from|import|require)\s*\(?\s*["']@viu\/emporix-sdk-react/;
    const offenders = files
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => importsReact.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the import probe actually matches an import", () => {
    // Without this, sharpening the regex above could silently make the guard
    // match nothing at all and pass vacuously.
    const importsReact = /(?:from|import|require)\s*\(?\s*["']@viu\/emporix-sdk-react/;
    expect(importsReact.test('import { x } from "@viu/emporix-sdk-react";')).toBe(true);
    expect(importsReact.test('import { x } from "@viu/emporix-sdk-react/storage";')).toBe(true);
    expect(importsReact.test('const x = require("@viu/emporix-sdk-react")')).toBe(true);
    expect(importsReact.test('await import("@viu/emporix-sdk-react")')).toBe(true);
    expect(importsReact.test("// see @viu/emporix-sdk-react/ssr for the React version")).toBe(
      false,
    );
  });

  it("does not declare the React package as a dependency of any kind", () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      expect(Object.keys(manifest[field] ?? {})).not.toContain("@viu/emporix-sdk-react");
    }
  });
});
