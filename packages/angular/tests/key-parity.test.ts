import { describe, expect, it } from "vitest";
import { emporixKey, siteMeta } from "@viu/emporix-sdk";
import { emporixQueryOptions } from "../src/query-options";

/**
 * The Angular and React bindings must produce byte-identical cache keys. Moving
 * the builder into the SDK made that structural rather than hoped for — but only
 * if this package actually routes through it. This test is what catches a
 * hand-rolled key sneaking in later.
 */
describe("cache-key parity with the shared builder", () => {
  const cases = [
    { site: "full" as const, siteCode: "main", language: "de", token: null },
    { site: "full" as const, siteCode: null, language: null, token: "t1" },
    { site: "language" as const, siteCode: "main", language: "en", token: "t1" },
    { site: "none" as const, siteCode: "main", language: "de", token: null },
  ];

  for (const c of cases) {
    it(`matches for site: ${c.site}, token: ${c.token ?? "none"}`, () => {
      const options = emporixQueryOptions(
        {
          resource: "product",
          args: ["p1"] as const,
          site: c.site,
          queryFn: async () => "v",
          mode: "read-auth",
        },
        { tenant: "acme", token: c.token, siteCode: c.siteCode, language: c.language },
      );
      const expected = emporixKey("product", ["p1"], {
        tenant: "acme",
        authKind: c.token !== null ? "customer" : "anonymous",
        ...siteMeta(c.site, c.siteCode, c.language),
      });
      expect(options.queryKey).toEqual(expected);
    });
  }
});
