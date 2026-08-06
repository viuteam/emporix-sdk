import type { Metadata } from "next";
import { getEmporixClient } from "@viu/emporix-sdk-next";

import { ProductGrid } from "../components/product-grid";
import { Note, Sheet } from "../components/sheet";
import { pricesFor } from "../lib/prices";
import { siteContext } from "../lib/site-context";
import { DEFAULT_LANGUAGE } from "../lib/languages";
import { TIMEOUTS } from "../emporix";

/** Per visitor, and an unbounded query space — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

/**
 * Search without a line of client-side state.
 *
 * The header's search box is a plain `<form action="/search" method="get">`, so
 * the browser puts the query in the URL and this page reads it. storefront-demo
 * keeps the same query in `useState` and navigates programmatically; here nobody
 * has to.
 *
 * Catalog reads use the memoized tagged client, not `withEmporixSession` — see
 * «The catalog/cart split» in the README.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const q = ((await searchParams).q ?? "").trim();
  const ctx = await siteContext();
  // Search reads `searchParams`, so it is dynamic no matter what — it keeps the
  // cookie language. The grid still needs a prefix for its product links.
  const lang = ctx.language ?? DEFAULT_LANGUAGE;
  const client = getEmporixClient({ context: ctx, timeouts: TIMEOUTS });

  // `searchByName` builds the Emporix `name:(~…)` filter and escapes the regex
  // metacharacters, so no quoting is needed here.
  const page = q === "" ? null : await client.products.searchByName(q, { pageSize: 24 }, undefined);
  const priceOf = await pricesFor(client, undefined, page?.items ?? []);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <Sheet
        meta={{ route: "/search", render: "dynamic", because: "searchParams" }}
        rail={
          <Note title="No client state">
            The header&rsquo;s search box is a plain <code>GET</code> form, so the
            browser puts the query in the URL and this page reads it. storefront-demo
            keeps the same query in <code>useState</code> and navigates
            programmatically; here nobody has to.
          </Note>
        }
      >
        <p className="eyebrow">Search</p>
        {/* `<h1>`, not `<h2>`: this is the heading of the page and there is none above
            it. A page that starts at h2 has no subject for a screen-reader user. */}
        <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
          {q === "" ? "Search the catalogue" : `«${q}»`}
        </h1>
        {page === null ? (
          <p className="muted">Type a query in the header.</p>
        ) : page.items.length === 0 ? (
          <p className="muted">Nothing found for «{q}».</p>
        ) : (
          <ProductGrid products={page.items} priceOf={priceOf} lang={lang} />
        )}
      </Sheet>
    </main>
  );
}
