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
});
