import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmporixClient } from "@viu/emporix-sdk-next";

import { ProductGrid } from "../../../../components/product-grid";
import { pricesFor } from "../../../../lib/prices";
import { siteContext } from "../../../../lib/site-context";
import { categoryIndex } from "../../../../lib/category-tree";
import { TIMEOUTS } from "../../../../emporix";

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
export const revalidate = 3600;

/**
 * Empty on purpose, and load-bearing.
 *
 * A dynamic segment with **no** `generateStaticParams` is rendered on demand and
 * NOT cached — verified against `next start`: the route answered
 * `Cache-Control: private, no-cache, no-store` and `revalidate` was ignored.
 * Returning an empty list says «prerender nothing, but treat every path as
 * cacheable», which is ISR for a catalogue too large to enumerate at build time
 * (1'631 categories on this tenant).
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ lang: string; id: string; page?: string[] }>;
}): Promise<React.JSX.Element> {
  const { lang, id, page: segments } = await params;
  // The page number is a PATH segment, not `?page=`. Reading `searchParams` opts
  // a route out of static rendering entirely, and this is the busiest route in
  // the demo — `/de/category/x/2` is cacheable, `/de/category/x?page=2` is not.
  // It also keeps the property the old comment claimed: page 3 is a URL.
  //
  // `Number(undefined) || 1` is 1, `Number("abc") || 1` is 1, `Number("0") || 1`
  // is 1, and Math.max catches a negative. A page number arrives from the URL, so
  // the bound is drawn even though no framework is doing it.
  const page = Math.max(1, Number(segments?.[0]) || 1);

  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });

  // Sequential, and NOT a Promise.all — measured 2026-08-04:
  // `productsIn("does-not-exist")` throws `EmporixNotFoundError`, so running both
  // in parallel lets that rejection win the race and the page 500s before
  // `notFound()` can run. The index is cached for an hour, so awaiting it first
  // costs a cache read on all but the first render of the hour.
  const index = await categoryIndex(lang);

  // The label and the hierarchy both come out of the tree, so `categories.get()`
  // is not called at all — one request fewer, and both are cached under the same
  // tag anyway.
  //
  // A category that exists but sits in no published tree therefore 404s here. On
  // the tenant this was measured against that cannot happen: `tree()` returned
  // 1'631 nodes and `categories.list()` counted 1'631 categories, so the tree is
  // the whole catalogue. A tenant with unpublished trees would need
  // `categories.get(id)` as a fallback.
  const entry = index.byId[id];
  if (entry === undefined) notFound();
  const children = entry.children;

  const products = await client.categories.productsIn(
    id,
    { pageNumber: page, pageSize: PAGE_SIZE },
    undefined,
  );
  const priceOf = await pricesFor(client, undefined, products.items);
  // Page one has no segment, so the canonical URL of a category is one URL and
  // not two — `/de/category/x` and `/de/category/x/1` would otherwise both
  // exist and split the cache.
  const href = (n: number): string =>
    n <= 1
      ? `/${lang}/category/${encodeURIComponent(id)}`
      : `/${lang}/category/${encodeURIComponent(id)}/${n}`;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      {/* The breadcrumb comes out of the index entry, prebuilt: no walk per
          render. It is not parity with storefront-demo — it has none — but
          «Building & Construction» is six levels deep on this tenant, and without
          it level 4 gives a shopper no idea where they are. */}
      <p className="eyebrow">
        <Link href={`/${lang}/categories`} className="u-underline">
          Categories
        </Link>
        {entry.path.map((a) => (
          <span key={a.id}>
            {" / "}
            <Link href={`/${lang}/category/${encodeURIComponent(a.id)}`} className="u-underline">
              {a.label}
            </Link>
          </span>
        ))}
      </p>
      {/* `<h1>`, nicht `<h2>`: der Kategoriename ist das Thema dieser Seite. */}
      <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>{entry.label}</h1>

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
          {/* `prefetch={false}` wie auf der Wurzelliste: bis zu 30 Unterkategorien,
              jede ein eigener Render mit `productsIn` plus `pricesFor`. Brotkrumen
              und Paginierung unten prefetchen weiter — die sind wenige und werden
              wirklich geklickt. */}
          {children.map((s) => (
            <Link
              key={s.id}
              href={`/${lang}/category/${encodeURIComponent(s.id)}`}
              className="u-underline"
              prefetch={false}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {products.items.length === 0 ? (
        page > 1 ? (
          // Past the last page, not an empty category. Saying «no products» here
          // would be a lie about the category — and a page number in a URL is
          // exactly the kind of thing that goes stale in a bookmark.
          <p className="muted">
            Nothing on page {page}. <Link href={href(1)} className="u-underline">Back to page 1</Link>.
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
          <ProductGrid products={products.items} priceOf={priceOf} lang={lang} />
          <nav
            className="cluster"
            aria-label="Pagination"
            style={{ gap: "var(--s-4)", marginTop: "var(--s-6)", alignItems: "center" }}
          >
            {page > 1 ? (
              <Link href={href(page - 1)} className="btn btn--outline">
                ← Previous
              </Link>
            ) : null}
            <span className="muted">Page {page}</span>
            {products.hasNextPage ? (
              <Link href={href(page + 1)} className="btn btn--outline">
                Next →
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </main>
  );
}
