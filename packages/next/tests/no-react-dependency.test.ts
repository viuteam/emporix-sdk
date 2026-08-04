import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

/**
 * This package must not need `@viu/emporix-sdk-react`. It used to, for the
 * session keys and the cookie-backed storage — neither of which was React, and
 * both now live in `@viu/emporix-sdk`. The point is what a consumer installs: a
 * server-first app makes no Emporix call from the browser, so pulling in the
 * React bindings dragged `react` and `@tanstack/react-query` (their peers) into
 * an app that has no client bundle.
 *
 * Structural, not stylistic: a single `import` re-introduces the whole tree, and
 * nothing else in the suite would notice.
 */
const SRC = new URL("../src", import.meta.url).pathname;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

describe("@viu/emporix-sdk-next stands alone", () => {
  it("does not declare the react package as a dependency", () => {
    const deps = {
      ...(pkg as { peerDependencies?: Record<string, string> }).peerDependencies,
      ...(pkg as { dependencies?: Record<string, string> }).dependencies,
    };
    expect(Object.keys(deps)).not.toContain("@viu/emporix-sdk-react");
    // The SDK and Next stay peers — those are real.
    expect(Object.keys(deps)).toContain("@viu/emporix-sdk");
    expect(Object.keys(deps)).toContain("next");
  });

  it("imports nothing from it anywhere in src", () => {
    // Matches import/export/require statements only. A prose mention in a comment
    // is fine — `session-auth.ts` names the hook it mirrors on purpose.
    const statement = /(?:from|require\()\s*["']@viu\/emporix-sdk-react/;
    const offenders = tsFiles(SRC).filter((f) => statement.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
