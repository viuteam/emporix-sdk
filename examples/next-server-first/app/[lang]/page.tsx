import { getEmporixClient } from "@viu/emporix-sdk-next";
import { PRICED_CATEGORY, TIMEOUTS } from "../emporix";
import { Typeahead } from "../typeahead";
import { ProductGrid } from "../components/product-grid";
import { pricesFor } from "../lib/prices";
import { siteContext } from "../lib/site-context";

/**
 * Catalog reads use the MEMOIZED, TAGGED client — not withEmporixSession.
 * withEmporixSession in a Server Component gets a read-only session handle, so the
 * anonymous session it obtains cannot be persisted and the next render would log
 * in again. Catalog data needs no stable session, so the process-wide token is
 * both correct and cheaper.
 *
 * **This lists one category on purpose, and it was tried the other way.**
 * storefront-demo's home calls `useProducts()`, so this briefly did the same with
 * `products.list()`. Measured against `viu` on 2026-08-04:
 *
 *   products.list(pageSize=12):  12 products, 0 with a price
 *   products.list(pageSize=50):  50 products, 0 with a price
 *   products.list(pageSize=200): 200 products, 0 with a price
 *
 * Twelve tiles, twelve «no price in this context», no «Add to cart» anywhere — an
 * entry page where the cart, checkout and account flows cannot be started. Only
 * the 16 childless category roots carry priced products on this tenant, and
 * `PRICED_CATEGORY` is one of them (11 tiles, 11 buttons). Honesty about unpriced
 * products is worth less here than a home page the rest of the demo can start from,
 * and `/categories` covers the browse-everything case a link away.
 */
export const revalidate = 3600;

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  // The language comes from the URL, not from a cookie — that is what lets this
  // page be static. See `app/[lang]/layout.tsx`.
  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });
  const page = await client.categories.productsIn(PRICED_CATEGORY, { pageSize: 12 }, undefined);
  const priceOf = await pricesFor(client, undefined, page.items);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Catalog</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Products from the priced category
      </h2>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        Adding needs a price — Emporix requires a <code>priceId</code> on internal
        cart items, so a product without one shows no button. Most of this tenant's
        catalogue has none, which is why this page shows one category rather than
        everything.
      </p>
      <p>
        <a href={`/${lang}/categories`} className="u-underline">
          Browse all categories →
        </a>
      </p>
      <p>
        <a href={`/${lang}/category/${PRICED_CATEGORY}`} className="u-underline">
          Browse this category with pagination →
        </a>
      </p>
      <Typeahead />
      <ProductGrid products={page.items} priceOf={priceOf} lang={lang} />
    </main>
  );
}
