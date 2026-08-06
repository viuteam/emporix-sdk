import type { Metadata } from "next";
import Link from "next/link";
import { categoryIndex } from "../../lib/category-tree";
import { isLanguage } from "../../lib/languages";
import { alternatesFor } from "../../lib/seo";
import { SITE_NAME } from "../../lib/site-url";
import { Note, Sheet } from "../../components/sheet";

/**
 * Every root category the tenant publishes.
 *
 * Roots, not all 1'631 categories: the tree is fully reachable from here by
 * drilling down, and rendering every node would be 378 KiB of links on one page.
 * The flat `categories.list()` is deliberately not used — it mixes every leaf in,
 * and on the `viu` tenant the overwhelming majority of leaves carry no products.
 *
 * No counts next to the names. The tenant has three roots called «Sports &
 * Outdoor» with exactly 30 leaves each, so a count would not tell them apart —
 * the one thing a reader would want it for.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLanguage(lang)) return {};
  // The same cached index the page renders from, so this is a cache read rather than
  // a second tree fetch. The count is the one honest thing there is to say about a
  // list of category names.
  const { roots } = await categoryIndex(lang);
  return {
    title: "Categories",
    description: `${roots.length} category trees, drillable down to every leaf the tenant publishes.`,
    alternates: alternatesFor(lang, "/categories"),
    openGraph: { type: "website", title: "Categories", siteName: SITE_NAME },
  };
}

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  const { roots } = await categoryIndex(lang);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <Sheet
        meta={{ route: "/[lang]/categories", render: "static", revalidate: 3600 }}
        rail={
          <>
            <Note title="Roots only">
              The tenant publishes 1&rsquo;631 categories in these trees. Rendering
              every node would be 378 KiB of links on one page, and the whole tree is
              reachable by drilling down from here.
            </Note>
            <Note title="Three of a name">
              Three roots are called «Sports &amp; Outdoor» with 30 leaves each, so a
              count next to the name would not tell them apart — the one thing a
              reader would want it for.
            </Note>
          </>
        }
      >
        <p className="eyebrow">Catalog</p>
        <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>Categories</h1>

        {roots.length === 0 ? (
          <p className="muted">This tenant publishes no category trees.</p>
        ) : (
          // Each entry used to carry `.cart__line` — a cart class on a category list,
          // left over from a copy-paste, and with no definition anywhere it did nothing
          // regardless. `.catnav` is the class for a row of category links.
          <nav className="catnav" aria-label="Category roots">
            {/* `prefetch={false}`: 21 roots on this page, and every category renders
                `productsIn` plus `pricesFor` on its first request. They all enter the
                viewport together — that would be over 40 Emporix calls for a page from
                which one category gets clicked. */}
            {roots.map((c) => (
              <Link
                key={c.id}
                href={`/${lang}/category/${encodeURIComponent(c.id)}`}
                className="u-underline"
                prefetch={false}
              >
                {c.label}
              </Link>
            ))}
          </nav>
        )}
      </Sheet>
    </main>
  );
}
