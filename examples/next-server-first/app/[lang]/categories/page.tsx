import { categoryIndex } from "../../lib/category-tree";
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
          // Zuvor trug jeder Eintrag `.cart__line` — eine Warenkorb-Klasse auf einer
          // Kategorieliste, uebrig aus einem Copy-Paste, und ohne Definition ohnehin
          // wirkungslos. `.catnav` ist die Klasse fuer eine Reihe Kategorielinks.
          <nav className="catnav" aria-label="Category roots">
            {roots.map((c) => (
              <a
                key={c.id}
                href={`/${lang}/category/${encodeURIComponent(c.id)}`}
                className="u-underline"
              >
                {c.label}
              </a>
            ))}
          </nav>
        )}
      </Sheet>
    </main>
  );
}
