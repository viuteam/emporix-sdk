import Link from "next/link";

/**
 * The 404 for anything under a valid language — which is every URL this app itself
 * produces.
 *
 * It lives here rather than at `app/not-found.tsx` because there is no root layout
 * there any more; a not-found at the app root would render without the shell, exactly
 * like the fragment measured on 2026-08-06.
 *
 * A path that matches no route at all still gets Next's built-in page. That is
 * accepted: it means somebody typed a URL this app never linked.
 */
export default function LangNotFound(): React.JSX.Element {
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">404</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>No such page</h1>
      {/* `/` on purpose: the proxy negotiates from there, so this one link works in
          either language without this component having to know which. */}
      <p className="muted">
        <Link href="/" className="u-underline">
          Back to the catalogue
        </Link>
      </p>
    </main>
  );
}
