import { categoryIndex } from "../../lib/category-tree";

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

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  const { roots } = await categoryIndex(lang);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Catalog</p>
      <h1 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Categories
      </h1>

      {roots.length === 0 ? (
        <p className="muted">This tenant publishes no category trees.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {roots.map((c) => (
            <li key={c.id} className="cart__line">
              <a href={`/${lang}/category/${encodeURIComponent(c.id)}`} className="u-underline serif">
                {c.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
