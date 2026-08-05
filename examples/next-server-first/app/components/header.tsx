import Link from "next/link";
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
 *
 * ## Die Prefetch-Regel dieser App
 *
 * Alle internen Links sind `<Link>` — auch in einer Server-First-Demo, denn `<Link>`
 * rendert ein `<a href>` und funktioniert damit ohne JavaScript genauso. Was es
 * dazugibt, ist clientseitige Navigation und Prefetching.
 *
 * Prefetching ist hier aber **nicht gratis**, weil Emporix pro API-Aufruf verrechnet
 * und die Katalogrouten ein leeres `generateStaticParams` haben: cachebar, aber nicht
 * vorgebaut. Der erste Aufruf einer URL rendert voll. Darum:
 *
 * - **`prefetch={false}`**, wo eine Seite viele Links auf teure Renders traegt —
 *   Produktkacheln, die Kategorie-Wurzelliste, die Unterkategorie-Navigation, die
 *   Bestellliste. Die geraten beim Scrollen alle gleichzeitig ins Blickfeld.
 * - **Standard-Prefetch** fuer Navigation mit wenigen Zielen und hoher Klickrate —
 *   Header, Brotkrumen, Paginierung, Konto-Navigation, Warenkorb, Login.
 *
 * Bewusst kein `prefetch={true}`: das erzwingt den vollen Render auch bei dynamischen
 * Routen.
 *
 * Und bewusst **kein** `prefetch={false}` auf `/cart`, `/login` oder `/account`,
 * obwohl das zunaechst richtig klingt — gemessen am 2026-08-05: der Standard-Prefetch
 * schickt `Next-Router-Segment-Prefetch: /_tree` und bekommt **183 Bytes** Routenbaum
 * zurueck, waehrend eine echte Navigation 5'973 Bytes mit dem Seiteninhalt liefert.
 * Der Prefetch rendert die Seite also nicht und kostet keinen Emporix-Aufruf. Wer das
 * hier «aufraeumen» will, nimmt Geschwindigkeit weg und spart nichts.
 *
 * Die **einzige** Ausnahme von `<Link>` ist der Sprachumschalter — er zeigt auf einen
 * Route-Handler, nicht auf eine Seite. Begruendung dort im Code.
 */
export function Header(): React.JSX.Element {
  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div
        className="container cluster"
        style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)", alignItems: "center" }}
      >
        <Link
          href="/"
          className="display"
          style={{ fontSize: "var(--step-1)", whiteSpace: "nowrap", fontWeight: 600 }}
        >
          Server<span style={{ color: "var(--redline)" }}>/</span>First
        </Link>

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
          <Link href="/categories" className="u-underline">
            Categories
          </Link>
          <Island>
            {/* `SessionNav` liefert zwei bis drei Geschwister. In der Klammer sind
                sie Kinder eines eigenen `div` und verlieren damit den Abstand, den
                die Navigation aussen setzt — der `.cluster` hier gibt ihn zurueck. */}
            <span className="cluster" style={{ gap: "var(--s-4)" }}>
              <SessionNav />
            </span>
          </Island>
          <Link href="/debug" className="u-underline">
            Debug
          </Link>
        </nav>
      </div>
    </header>
  );
}
