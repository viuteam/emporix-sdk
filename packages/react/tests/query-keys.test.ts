import { describe, it, expect } from "vitest";
import { emporixKey, siteMeta } from "../src/hooks/internal/query-keys";

describe("siteMeta", () => {
  it("'full' carries both siteCode and language", () => {
    expect(siteMeta("full", "main", "de")).toEqual({ siteCode: "main", language: "de" });
  });

  it("'full' preserves nulls rather than dropping the fields", () => {
    expect(siteMeta("full", null, null)).toEqual({ siteCode: null, language: null });
  });

  it("'language' carries only language", () => {
    const meta = siteMeta("language", "main", "de");
    expect(meta).toEqual({ language: "de" });
    expect("siteCode" in meta).toBe(false);
  });

  it("'none' carries neither", () => {
    expect(siteMeta("none", "main", "de")).toEqual({});
  });
});

describe("emporixKey with siteMeta", () => {
  it("produces the shape the hooks assert (read-auth + full site)", () => {
    expect(
      emporixKey("product", ["p1"], {
        tenant: "acme",
        authKind: "anonymous",
        ...siteMeta("full", null, null),
      }),
    ).toEqual([
      "emporix",
      "product",
      "p1",
      { tenant: "acme", authKind: "anonymous", siteCode: null, language: null },
    ]);
  });

  it("drops site fields entirely for 'none'", () => {
    expect(
      emporixKey("sites", [], {
        tenant: "acme",
        authKind: "anonymous",
        ...siteMeta("none", "main", "de"),
      }),
    ).toEqual(["emporix", "sites", { tenant: "acme", authKind: "anonymous" }]);
  });

  /**
   * A page fetched with `totalCount: true` carries a field a page without it
   * does not, so the two must not share a cache entry. `emporixKey` spreads
   * `args` wholesale and the list hooks pass their params object in intact
   * (`args: [params]`), so this holds structurally — pinned here because it
   * would break silently if a hook ever started picking fields out of params.
   */
  it("gives a totals request its own cache key", () => {
    const ctx = { tenant: "acme", authKind: "anonymous" };
    const withoutTotals = emporixKey("products", [{ pageNumber: 1, pageSize: 50 }], ctx);
    const withTotals = emporixKey(
      "products",
      [{ pageNumber: 1, pageSize: 50, totalCount: true }],
      ctx,
    );
    expect(withTotals).not.toEqual(withoutTotals);
  });
});
