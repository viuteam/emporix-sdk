import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, jsonLdScript, productJsonLd } from "../app/lib/json-ld";

describe("productJsonLd", () => {
  it("emits the fields a Product needs", () => {
    const ld = productJsonLd({
      name: "Just-in-Time Access",
      url: "https://shop.test/de/product/abc",
      description: "Time-boxed elevation.",
      sku: "iam-jit-access",
      price: { amount: 1, currency: "CHF" },
    });
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Just-in-Time Access");
    expect(ld.sku).toBe("iam-jit-access");
    expect(ld.offers).toEqual({
      "@type": "Offer",
      price: 1,
      priceCurrency: "CHF",
      url: "https://shop.test/de/product/abc",
    });
  });

  it("omits offers when there is no price", () => {
    // Most of this tenant's catalogue has no price in the main/CHF/CH context, and a
    // Product without an Offer is valid markup. An Offer with a made-up price is not.
    const ld = productJsonLd({ name: "X", url: "https://shop.test/de/product/x" });
    expect(ld.offers).toBeUndefined();
  });

  it("omits description and sku rather than emitting empty strings", () => {
    const ld = productJsonLd({ name: "X", url: "u", description: "", sku: "" });
    expect("description" in ld).toBe(false);
    expect("sku" in ld).toBe(false);
  });

  it("never claims availability", () => {
    // Measured 2026-08-06: the tenant has no availability records — `availability.get`
    // 404s and `getMany` synthesises `available: false` for every priced product.
    // Emitting InStock would be a lie and OutOfStock would contradict a working
    // «Add to cart» button.
    const ld = productJsonLd({
      name: "X",
      url: "u",
      price: { amount: 1, currency: "CHF" },
    });
    expect(JSON.stringify(ld)).not.toContain("availability");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the positions from one", () => {
    const ld = breadcrumbJsonLd([
      { name: "Categories", url: "https://shop.test/de/categories" },
      { name: "Building", url: "https://shop.test/de/category/b" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Categories",
        item: "https://shop.test/de/categories",
      },
      { "@type": "ListItem", position: 2, name: "Building", item: "https://shop.test/de/category/b" },
    ]);
  });
});

describe("jsonLdScript", () => {
  it("escapes a closing script tag out of the payload", () => {
    // The one test that matters here. Tenant text goes into a <script> body, so a
    // description containing `</script>` would end the element and everything after it
    // would be parsed as HTML. Measured 2026-08-06: 0 of 200 descriptions on this tenant
    // contain `<` at all — which is exactly why an unescaped implementation would pass
    // every test written against today's data.
    const out = jsonLdScript({ description: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });

  it("still round-trips as JSON", () => {
    const value = { a: "<b>", c: [1, 2] };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });
});
