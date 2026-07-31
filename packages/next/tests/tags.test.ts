import { describe, it, expect } from "vitest";
import { emporixTags, emporixTagsForUrl } from "../src/tags";

const H = "https://api.emporix.io";
const T = "acme";

describe("emporixTags", () => {
  it("builds stable tag strings", () => {
    expect(emporixTags.product("p1")).toBe("emporix:product:p1");
    expect(emporixTags.products).toBe("emporix:products");
    expect(emporixTags.category("c1")).toBe("emporix:category:c1");
    expect(emporixTags.categories).toBe("emporix:categories");
    expect(emporixTags.categoryTree("t1")).toBe("emporix:category-tree:t1");
    expect(emporixTags.prices).toBe("emporix:prices");
    expect(emporixTags.availability).toBe("emporix:availability");
    expect(emporixTags.sites).toBe("emporix:sites");
  });
});

describe("emporixTagsForUrl — the mapping", () => {
  it("tags a single product with both its id tag and the collection", () => {
    expect(emporixTagsForUrl(`${H}/product/${T}/products/p1`, T)).toEqual([
      "emporix:product:p1",
      "emporix:products",
    ]);
  });

  it("tags a product listing with the collection only", () => {
    expect(emporixTagsForUrl(`${H}/product/${T}/products`, T)).toEqual(["emporix:products"]);
  });

  it("tags a single category and its sub-resources with the category", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1/subcategories`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1/parents`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
  });

  it("tags category trees separately", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/category-trees/t1`, T)).toEqual([
      "emporix:category-tree:t1",
      "emporix:categories",
    ]);
  });

  it("tags price, availability and site reads by service", () => {
    expect(emporixTagsForUrl(`${H}/price/${T}/match-prices`, T)).toEqual(["emporix:prices"]);
    expect(emporixTagsForUrl(`${H}/availability/${T}/availability/site/main`, T)).toEqual([
      "emporix:availability",
    ]);
    expect(emporixTagsForUrl(`${H}/site/${T}/sites`, T)).toEqual(["emporix:sites"]);
  });

  it("decodes a percent-encoded id so the tag matches a webhook's raw id", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/category-trees/a%2Fb`, T)).toEqual([
      "emporix:category-tree:a/b",
      "emporix:categories",
    ]);
  });
});

describe("emporixTagsForUrl — reserved segments must not become ids", () => {
  // These are all real Emporix paths and all look like /products/{id}.
  it.each([
    [`${H}/product/${T}/products/bulk`, ["emporix:products"]],
    [`${H}/product/${T}/products/search`, ["emporix:products"]],
    [`${H}/product/${T}/products/recalculate`, ["emporix:products"]],
    [`${H}/product/${T}/products/recalculate/jobs`, ["emporix:products"]],
    [`${H}/category/${T}/categories/search`, ["emporix:categories"]],
    [`${H}/category/${T}/category-trees/search`, ["emporix:categories"]],
  ])("%s → %j", (url, expected) => {
    expect(emporixTagsForUrl(url, T)).toEqual(expected);
  });

  it("never emits an id tag for a reserved segment", () => {
    const tags = emporixTagsForUrl(`${H}/product/${T}/products/bulk`, T);
    expect(tags).not.toContain("emporix:product:bulk");
  });
});

describe("emporixTagsForUrl — everything else is untagged", () => {
  it.each([
    `${H}/product/other-tenant/products/p1`, // wrong tenant
    `${H}/product/${T}/product-templates/t1`, // untagged collection
    `${H}/category/${T}/assignments/references/r1`, // untagged collection
    `${H}/cart/${T}/carts/c1`, // cart is never cached
    `${H}/customerlogin/auth/anonymous/login`, // token endpoint
    `${H}/order-v2/${T}/orders/o1`, // personalized
    "not-a-url",
    `${H}/`,
  ])("%s → []", (url) => {
    expect(emporixTagsForUrl(url, T)).toEqual([]);
  });
});
