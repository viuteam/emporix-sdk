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
 * Every link carries the language, because the shell renders inside `/[lang]/…` and
 * therefore always knows it. Until 2026-08-06 the catalog links were unprefixed and
 * relied on a redirect to the visitor's language — one hop per link, on every page, and
 * one whose target depended on a cookie a crawler does not keep.
 *
 * The search box is a plain GET form. storefront-demo's header keeps the query
 * in `useState` and navigates programmatically; here the browser does it.
 *
 * ## This app's prefetch rule
 *
 * Every internal link is a `<Link>`, in a server-first demo too: `<Link>` renders an
 * `<a href>`, so it works with JavaScript off exactly as a bare anchor did. What it
 * adds is client-side navigation and prefetching.
 *
 * Prefetching is **not free** here, because Emporix bills per API call and the catalog
 * routes carry an empty `generateStaticParams`: cacheable, but not prebuilt, so the
 * first request for a URL renders in full. Hence:
 *
 * - **`prefetch={false}`** where one page holds many links to expensive renders —
 *   product tiles, the category root list, the subcategory nav, the order list. Those
 *   all enter the viewport together while scrolling.
 * - **Default prefetch** for navigation with few targets and a high click-through —
 *   header, breadcrumbs, pagination, account nav, cart, login.
 *
 * Deliberately no `prefetch={true}`: that would force the full render on dynamic
 * routes as well.
 *
 * And deliberately **no** `prefetch={false}` on `/cart`, `/login` or `/account`, even
 * though that sounds right at first — measured 2026-08-05: the default prefetch sends
 * `Next-Router-Segment-Prefetch: /_tree` and gets **183 bytes** of route tree back,
 * while a real navigation returns 5'973 bytes with the page content. The prefetch does
 * not render the page and costs no Emporix call. Anyone "cleaning this up" would take
 * away speed and save nothing.
 *
 * There is no exception to `<Link>` any more. The language switcher used to be the one
 * `<a>` in this app because its target was a route handler that wrote a cookie; the
 * language lives in the URL now, so it points at a page like everything else.
 */
export function Header({ lang }: { lang: string }): React.JSX.Element {
  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div
        className="container cluster"
        style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)", alignItems: "center" }}
      >
        <Link
          href={`/${lang}`}
          className="display"
          style={{ fontSize: "var(--step-1)", whiteSpace: "nowrap", fontWeight: 600 }}
        >
          Server<span style={{ color: "var(--redline)" }}>/</span>First
        </Link>

        {/* With `flex: 1` alone the 26rem field stuck out past the page edge on a
            390px viewport; with `minWidth: 0` it collapsed to nothing instead. A lower
            bound plus a growth basis solves both: when it does not fit beside the logo
            and the nav, `.cluster` breaks it onto a line of its own. */}
        <form
          action={`/${lang}/search`}
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
          {/* The shell's two islands, marked with the redline bracket: this is
              everything that hydrates in the browser on every page. No label, because
              there is no room for one here — the legend sits in the title block of the
              annotation rail. */}
          <Island>
            <LanguageSwitcher />
          </Island>
          {/* A link, deliberately, and not a dropdown. Rendering the category tree here
              would put an Emporix call in the shell and break the invariant this file's
              doc comment claims — /categories carries that cost instead. */}
          <Link href={`/${lang}/categories`} className="u-underline">
            Categories
          </Link>
          <Island>
            {/* `SessionNav` returns two or three siblings. Inside the bracket they are
                children of their own `div` and lose the gap the nav sets outside it —
                the `.cluster` here gives it back. */}
            <span className="cluster" style={{ gap: "var(--s-4)" }}>
              <SessionNav lang={lang} />
            </span>
          </Island>
          <Link href={`/${lang}/debug`} className="u-underline">
            Debug
          </Link>
        </nav>
      </div>
    </header>
  );
}
