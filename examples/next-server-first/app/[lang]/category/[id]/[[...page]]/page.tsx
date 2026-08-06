import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getEmporixClient } from "@viu/emporix-sdk-next";

import { ProductGrid } from "../../../../components/product-grid";
import { pricesFor } from "../../../../lib/prices";
import { isLanguage } from "../../../../lib/languages";
import { parsePageSegment } from "../../../../lib/page-segment";
import { alternatesFor } from "../../../../lib/seo";
import { SITE_NAME } from "../../../../lib/site-url";
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

/**
 * The page number is part of the title and part of the canonical, and both matter.
 *
 * A paginated list **self-canonicalises**: page 3 is its own document, not a
 * duplicate of page 1, and pointing it at page 1 would hide its products from search
 * entirely. The one exception is the page-1 alias — `/de/category/x/1` renders the
 * same HTML as `/de/category/x`, so it canonicalises to the bare URL. The same
 * `page <= 1` rule the `href()` helper below uses, for the same reason.
 *
 * Reads the cached index, so no extra Emporix call: the page body asks for the same
 * entry a moment later and gets the memoized answer.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string; page?: string[] }>;
}): Promise<Metadata> {
  const { lang, id, page: segments } = await params;
  if (!isLanguage(lang)) return {};
  // An alias or an invalid segment never renders, so it gets no metadata either — the
  // redirect and the 404 in the page body own those two cases.
  const parsed = parsePageSegment(segments);
  if (parsed.kind !== "page") return {};
  const page = parsed.page;

  const { byId } = await categoryIndex(lang);
  const entry = byId[id];
  // The page renders `notFound()` for this case; an empty object leaves the 404 page
  // its own title.
  if (entry === undefined) return {};

  const title = page > 1 ? `${entry.label} — page ${page}` : entry.label;
  const where = entry.path.length > 0 ? ` in ${entry.path.map((a) => a.label).join(" / ")}` : "";
  const suffix =
    page > 1
      ? `/category/${encodeURIComponent(id)}/${page}`
      : `/category/${encodeURIComponent(id)}`;

  return {
    title,
    description: `${entry.label}${where}${entry.children.length > 0 ? ` · ${entry.children.length} subcategories` : ""}.`,
    alternates: alternatesFor(lang, suffix),
    openGraph: { type: "website", title, siteName: SITE_NAME },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ lang: string; id: string; page?: string[] }>;
}): Promise<React.JSX.Element> {
  const { lang, id, page: segments } = await params;
  // The page number is a PATH segment, not `?page=`. Reading `searchParams` opts a
  // route out of static rendering entirely, and this is the busiest route in the demo —
  // `/de/category/x/2` is cacheable, `/de/category/x?page=2` is not. It also keeps the
  // property the old comment claimed: page 3 is a URL.
  //
  // Three outcomes, three HTTP answers — see `lib/page-segment.ts`. Measured 2026-08-06,
  // nine shapes of this URL answered 200 before: `/1`, `/0`, `/abc`, `/-1`, `/01`,
  // `/2/3/4`, `/99999` and two more, four of them rendering page one under a URL that is
  // not page one.
  //
  // `/1` redirects rather than 404s: it renders exactly what the bare URL renders, it is
  // a URL a human would type, and another site may already link it.
  const parsed = parsePageSegment(segments);
  if (parsed.kind === "invalid") notFound();
  if (parsed.kind === "alias") {
    permanentRedirect(`/${lang}/category/${encodeURIComponent(id)}`);
  }
  const page = parsed.page;

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
  // A page past the last one is not a document. It used to answer 200 with «Nothing on
  // page N» — a soft 404, and since the metadata PR one that nominated itself as its own
  // canonical. `page > 1` matters: an empty page 1 is an empty category, which is a real
  // page with a real answer.
  if (products.items.length === 0 && page > 1) notFound();

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

      {/* The «Nothing on page N» branch that used to live here is gone: a page past the
          last one now 404s above, so this only ever sees page one. */}
      {products.items.length === 0 ? (
        children.length > 0 ? (
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
