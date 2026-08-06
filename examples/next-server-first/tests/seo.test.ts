import { describe, expect, it } from "vitest";
import { alternatesFor } from "../app/lib/seo";

describe("alternatesFor", () => {
  it("builds a self-referencing canonical", () => {
    expect(alternatesFor("de", "/product/abc").canonical).toBe("/de/product/abc");
    expect(alternatesFor("en", "/product/abc").canonical).toBe("/en/product/abc");
  });

  it("treats the empty suffix as the language home", () => {
    expect(alternatesFor("de", "").canonical).toBe("/de");
  });

  it("lists every language plus x-default", () => {
    const { languages } = alternatesFor("de", "/categories");
    expect(languages).toEqual({
      de: "/de/categories",
      en: "/en/categories",
      "x-default": "/de/categories",
    });
  });

  it("points x-default at the default language, not at the current one", () => {
    // Otherwise the English page would nominate itself as the fallback for every
    // locale nobody has a page for.
    expect(alternatesFor("en", "/categories").languages["x-default"]).toBe("/de/categories");
  });

  it("keeps a page suffix in every alternate", () => {
    const { canonical, languages } = alternatesFor("de", "/category/abc/3");
    expect(canonical).toBe("/de/category/abc/3");
    expect(languages.en).toBe("/en/category/abc/3");
  });
});
