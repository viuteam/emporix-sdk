import { getEmporixClient } from "@viu/emporix-sdk-next";
import { catId, catLabel } from "@viu/emporix-examples-shared";
import { CONTEXT } from "../../emporix";
import { ProductGrid } from "../../components/product-grid";
import { pricesFor } from "../../lib/prices";

const PAGE_SIZE = 24;

/**
 * Pagination through the URL, which is the whole point of this page.
 *
 * storefront-demo uses `useProductsInCategoryInfinite` and a «Load more» button
 * that appends. That needs client state to hold the accumulated pages, and there
 * is none here — so this **pages** instead of appending. A real behavioural
 * difference, not a cosmetic one, and the honest shape for a server-first mode.
 *
 * The upside: page 3 is a URL. It can be linked, bookmarked and crawled, which an
 * accumulating list cannot.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  // `Number(undefined) || 1` is 1, `Number("abc") || 1` is 1, `Number("0") || 1`
  // is 1, and Math.max catches a negative. A page number arrives from the URL, so
  // the bound is drawn even though no framework is doing it.
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const client = getEmporixClient({ context: CONTEXT });
  const [category, subs, products] = await Promise.all([
    client.categories.get(id, undefined),
    client.categories.subcategories(id, { pageSize: 50 }, undefined),
    client.categories.productsIn(id, { pageNumber: page, pageSize: PAGE_SIZE }, undefined),
  ]);
  const priceOf = await pricesFor(client, undefined, products.items);
  const href = (n: number): string => `/category/${encodeURIComponent(id)}?page=${n}`;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Category</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {catLabel(category)}
      </h2>

      {/* Never renders on the `viu` tenant: `subcategories` reads category-to-
          category ASSIGNMENTS, and this tenant keeps its hierarchy in category
          trees instead — checked against the first 40 categories on 2026-08-03,
          every one of them answered with an empty list. storefront-demo's
          equivalent nav is dead here for the same reason, since it calls the same
          thing. Kept because other tenants do use assignments. */}
      {subs.length > 0 ? (
        <nav
          className="catnav"
          aria-label="Subcategories"
          style={{
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
            marginBottom: "var(--s-6)",
          }}
        >
          {subs.map((s) => (
            <a
              key={catId(s)}
              href={`/category/${encodeURIComponent(catId(s))}`}
              className="u-underline"
            >
              {catLabel(s)}
            </a>
          ))}
        </nav>
      ) : null}

      {products.items.length === 0 ? (
        page > 1 ? (
          // Past the last page, not an empty category. Saying «no products» here
          // would be a lie about the category — and a page number in a URL is
          // exactly the kind of thing that goes stale in a bookmark.
          <p className="muted">
            Nothing on page {page}. <a href={href(1)} className="u-underline">Back to page 1</a>.
          </p>
        ) : subs.length > 0 ? (
          // A pure parent category holds only subcategories, so the tiles above
          // are the answer — an «empty» notice would be wrong there.
          null
        ) : (
          <p className="muted">No products in this category.</p>
        )
      ) : (
        <>
          <ProductGrid products={products.items} priceOf={priceOf} />
          <nav
            className="cluster"
            aria-label="Pagination"
            style={{ gap: "var(--s-4)", marginTop: "var(--s-6)", alignItems: "center" }}
          >
            {page > 1 ? (
              <a href={href(page - 1)} className="btn btn--outline">
                ← Previous
              </a>
            ) : null}
            <span className="muted">Page {page}</span>
            {products.hasNextPage ? (
              <a href={href(page + 1)} className="btn btn--outline">
                Next →
              </a>
            ) : null}
          </nav>
        </>
      )}
    </main>
  );
}
