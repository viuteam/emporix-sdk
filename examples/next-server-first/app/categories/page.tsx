import { catId, catLabel } from "@viu/emporix-examples-shared";
import { categoryTree } from "../lib/category-tree";

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
export default async function CategoriesPage(): Promise<React.JSX.Element> {
  const roots = await categoryTree();

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
            <li key={catId(c)} className="cart__line">
              <a href={`/category/${encodeURIComponent(catId(c))}`} className="u-underline serif">
                {catLabel(c)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
