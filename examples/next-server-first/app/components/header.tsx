import { LanguageSwitcher } from "./language-switcher";
import { SessionNav } from "./session-nav";
import { Island } from "./sheet";

/**
 * A Server Component that makes zero Emporix calls **and reads no cookies**.
 *
 * The second half is newer than the first and it is what makes the catalog
 * cacheable. This header sits in the root layout, so anything it reads, every
 * route reads: one `cookies()` call here marked all eighteen routes dynamic,
 * including four catalog pages whose HTML is identical for every visitor.
 *
 * The two personalised bits are client islands now — `SessionNav` fetches
 * `/api/session/nav` after the page is served, `LanguageSwitcher` derives the
 * active language from `usePathname()`. A Server Component may render a Client
 * Component without becoming dynamic, which is the whole trick.
 *
 * The catalog links stay unprefixed (`/`, `/categories`). Both redirect to the
 * visitor's language, which costs one cheap hop and keeps this file free of
 * routing logic it would otherwise have to duplicate per route.
 *
 * The search box is a plain GET form. storefront-demo's header keeps the query
 * in `useState` and navigates programmatically; here the browser does it.
 */
export function Header(): React.JSX.Element {
  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div
        className="container cluster"
        style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)", alignItems: "center" }}
      >
        <a
          href="/"
          className="display"
          style={{ fontSize: "var(--step-1)", whiteSpace: "nowrap", fontWeight: 600 }}
        >
          Server<span style={{ color: "var(--redline)" }}>/</span>First
        </a>

        {/* Mit `flex: 1` allein stand das 26rem-Feld auf einem 390px-Viewport ueber
            dem Seitenrand hinaus, mit `minWidth: 0` schrumpfte es stattdessen auf
            null. Eine Untergrenze plus Wachstumsbasis loest beides: passt es nicht
            neben Logo und Navigation, bricht `.cluster` es auf eine eigene Zeile. */}
        <form
          action="/search"
          method="get"
          style={{ flex: "1 1 14rem", minWidth: "12rem", maxWidth: "26rem" }}
        >
          <input
            className="input"
            type="search"
            name="q"
            placeholder="Search the catalogue…"
            aria-label="Search products"
          />
        </form>

        <nav
          className="cluster"
          style={{ gap: "var(--s-4)", marginLeft: "auto", fontSize: "var(--step--1)" }}
        >
          {/* Die zwei Inseln der Shell, mit der Redline-Klammer markiert: das ist
              alles, was auf jeder Seite im Browser hydriert. Ohne Beschriftung, weil
              hier kein Platz dafuer ist — die Legende steht im Schriftfeld der
              Marginalie. */}
          <Island>
            <LanguageSwitcher />
          </Island>
          {/* A plain anchor, deliberately. Rendering the category tree here would
              put an Emporix call in the shell and break the invariant this file's
              doc comment claims — /categories carries that cost instead. */}
          <a href="/categories" className="u-underline">
            Categories
          </a>
          <Island>
            {/* `SessionNav` liefert zwei bis drei Geschwister. In der Klammer sind
                sie Kinder eines eigenen `div` und verlieren damit den Abstand, den
                die Navigation aussen setzt — der `.cluster` hier gibt ihn zurueck. */}
            <span className="cluster" style={{ gap: "var(--s-4)" }}>
              <SessionNav />
            </span>
          </Island>
          <a href="/debug" className="u-underline">
            Debug
          </a>
        </nav>
      </div>
    </header>
  );
}
