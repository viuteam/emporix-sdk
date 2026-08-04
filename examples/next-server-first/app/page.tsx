import { getEmporixClient } from "@viu/emporix-sdk-next";
import { Typeahead } from "./typeahead";
import { ProductGrid } from "./components/product-grid";
import { pricesFor } from "./lib/prices";
import { siteContext } from "./lib/site-context";

/**
 * Catalog reads use the MEMOIZED, TAGGED client — not withEmporixSession.
 * withEmporixSession in a Server Component gets a read-only cookie jar, so the
 * anonymous session it obtains cannot be persisted and the next render would log
 * in again. Catalog data needs no stable session, so the process-wide token is
 * both correct and cheaper.
 *
 * This used to list one hard-coded category so every tile was guaranteed a price.
 * `products.list` is what storefront-demo's home does, and it makes the demo
 * honest: a tenant's products are not all priced, so some tiles have no button.
 * That is the lesson, and hiding it behind a curated category taught nothing.
 */
export default async function Home(): Promise<React.JSX.Element> {
  const client = getEmporixClient({ context: await siteContext() });
  const page = await client.products.list({ pageSize: 12 }, undefined);
  const priceOf = await pricesFor(client, undefined, page.items);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Catalog</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Products
      </h2>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        Adding needs a price — Emporix requires a <code>priceId</code> on internal
        cart items, so a product without one shows no button.
      </p>
      <p>
        <a href="/categories" className="u-underline">
          Browse all categories →
        </a>
      </p>
      <Typeahead />
      <ProductGrid products={page.items} priceOf={priceOf} />
    </main>
  );
}
