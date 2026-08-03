import { getEmporixClient } from "@viu/emporix-sdk-next";
import { PRICED_CATEGORY } from "./emporix";
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
 */
export default async function Home(): Promise<React.JSX.Element> {
  const client = getEmporixClient({ context: await siteContext() });
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
        cart items, so a product without one shows no button.
      </p>
      <p>
        <a href={`/category/${PRICED_CATEGORY}`} className="u-underline">
          Browse the category with pagination →
        </a>
      </p>
      <Typeahead />
      <ProductGrid products={page.items} priceOf={priceOf} />
    </main>
  );
}
