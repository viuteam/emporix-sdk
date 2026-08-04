import { notFound } from "next/navigation";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { catId, catLabel } from "@viu/emporix-examples-shared";

import { ProductGrid } from "../../components/product-grid";
import { pricesFor } from "../../lib/prices";
import { siteContext } from "../../lib/site-context";
import { categoryTree } from "../../lib/category-tree";
import { findCategory } from "../../lib/category-walk";

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

  const client = getEmporixClient({ context: await siteContext() });

  // Sequential, and NOT a Promise.all — measured 2026-08-04:
  // `productsIn("does-not-exist")` throws `EmporixNotFoundError`, so running both
  // in parallel lets that rejection win the race and the page 500s before
  // `notFound()` can run. The tree is cached for an hour, so awaiting it first
  // costs a cache read on all but the first request of the hour.
  const roots = await categoryTree();

  // The label and the hierarchy both come out of the tree, so `categories.get()`
  // is not called at all — one request fewer, and both are cached under the same
  // tag anyway.
  //
  // A category that exists but sits in no published tree therefore 404s here. On
  // the tenant this was measured against that cannot happen: `tree()` returned
  // 1'631 nodes and `categories.list()` counted 1'631 categories, so the tree is
  // the whole catalogue. A tenant with unpublished trees would need
  // `categories.get(id)` as a fallback.
  const found = findCategory(roots, id);
  if (found === null) notFound();
  const children = found.node.subcategories ?? [];

  const products = await client.categories.productsIn(
    id,
    { pageNumber: page, pageSize: PAGE_SIZE },
    undefined,
  );
  const priceOf = await pricesFor(client, undefined, products.items);
  const href = (n: number): string => `/category/${encodeURIComponent(id)}?page=${n}`;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      {/* Ancestors come from the same walk that found the node, so the breadcrumb
          costs nothing. It is not parity with storefront-demo — it has none — but
          «Building & Construction» is six levels deep on this tenant, and without
          it level 4 gives a shopper no idea where they are. */}
      <p className="eyebrow">
        <a href="/categories" className="u-underline">
          Categories
        </a>
        {found.ancestors.map((a) => (
          <span key={catId(a)}>
            {" / "}
            <a href={`/category/${encodeURIComponent(catId(a))}`} className="u-underline">
              {catLabel(a)}
            </a>
          </span>
        ))}
      </p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {catLabel(found.node)}
      </h2>

      {/* Children from the TREE, not from `categories.subcategories()`. That call
          reads category-to-category assignments — the same `/assignments` URL
          `productsIn` uses, filtered to `ref.type === "CATEGORY"` instead of
          `"PRODUCT"` — and this tenant expresses hierarchy in trees, so that filter
          answered empty for every category tried. Which is why this nav used to be
          dead, and why storefront-demo's still is. The hierarchy was always
          available; the old code read the wrong source. */}
      {children.length > 0 ? (
        <nav
          className="catnav"
          aria-label="Subcategories"
          style={{
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
            marginBottom: "var(--s-6)",
          }}
        >
          {children.map((s) => (
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
        ) : children.length > 0 ? (
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
