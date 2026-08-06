/**
 * Schema.org output for the two catalog pages that have something to say.
 *
 * **No SDK types and no server imports**, and both are deliberate. It keeps the module
 * loadable by vitest, and it is the shape that would let this move into
 * `@viu/emporix-sdk-next` unchanged if a second server-rendered consumer ever wants it.
 * Today there is one — this demo — so it stays here. Mapping Emporix shapes onto these
 * inputs happens at the page.
 *
 * What is deliberately absent:
 *
 * - **`image`** — `media` is `[]` on every product sampled on this tenant.
 * - **`availability`** — measured 2026-08-06, the tenant carries no availability records
 *   at all: `availability.get` answers 404 and `getMany` synthesises `available: false`
 *   for every priced product. `InStock` would be invented and `OutOfStock` would
 *   contradict an «Add to cart» button that demonstrably works, and structured data that
 *   disagrees with the page is worse than none. A tenant that does keep records should
 *   call `availability.getMany` — one batched request for a whole grid — and pass the
 *   result in.
 * - **`gtin`/`mpn`** — absent from the Emporix product shape. `code` is the merchant code
 *   and is what `sku` gets.
 */

/** A Product, with an Offer only when there is a real price. */
export function productJsonLd(input: {
  name: string;
  url: string;
  description?: string;
  sku?: string;
  price?: { amount: number; currency: string };
}): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
  };
  // Empty strings are omitted rather than emitted: `description: ""` is a claim that the
  // product has an empty description, which is not the same as not knowing.
  if (input.description !== undefined && input.description !== "") {
    ld.description = input.description;
  }
  if (input.sku !== undefined && input.sku !== "") ld.sku = input.sku;
  if (input.price !== undefined) {
    ld.offers = {
      "@type": "Offer",
      price: input.price.amount,
      priceCurrency: input.price.currency,
      url: input.url,
    };
  }
  return ld;
}

/** A BreadcrumbList. `items` is in document order, ancestors first. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Serialize for a `<script type="application/ld+json">` body.
 *
 * `JSON.stringify` alone is **not** safe here. The payload carries merchant text, and a
 * description containing `</script>` would close the element — everything after it would
 * then be parsed as HTML. `<` is valid inside a JSON string and decodes back to `<`,
 * so escaping every `<` costs nothing and closes the hole without having to know which
 * sequences matter.
 *
 * Measured 2026-08-06: 0 of 200 descriptions on this tenant contain `<` at all. That is
 * the reason this is a function with a test rather than an inline `JSON.stringify` — the
 * unescaped version passes everything today.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
