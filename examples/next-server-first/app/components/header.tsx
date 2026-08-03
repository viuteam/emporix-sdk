import { emporixSession, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { cartCount } from "../lib/cart-session";
import { logout } from "../actions/auth";

/**
 * A Server Component that makes **zero** Emporix calls.
 *
 * That is the point worth copying: the badge count comes from the session (see
 * `lib/cart-session.ts`), and «am I logged in» comes from whether a token is
 * stored. Neither needs the network, so putting the header in the root layout
 * costs nothing per page view.
 *
 * The search box is a plain GET form. storefront-demo's header keeps the query
 * in `useState` and navigates programmatically; here the browser does it, so
 * this file needs no `"use client"` at all.
 */
export async function Header(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);
  const count = cartCount(jar);

  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div
        className="container cluster"
        style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)", alignItems: "center" }}
      >
        <a href="/" className="serif" style={{ fontSize: "var(--step-1)", whiteSpace: "nowrap" }}>
          Server<span style={{ color: "var(--oxblood)" }}>—</span>First
        </a>

        <form action="/search" method="get" style={{ flex: 1, maxWidth: "26rem" }}>
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
          <a href="/cart" className="u-underline">
            Cart{count > 0 ? ` (${count})` : ""}
          </a>
          {customerToken === null ? (
            <a href="/login" className="u-underline">
              Login
            </a>
          ) : (
            // No /account link yet — that route arrives with the account pages.
            // Linking it early would ship a 404 in whatever lands first.
            <form action={logout} style={{ display: "inline" }}>
              <button type="submit" className="btn btn--ghost btn--sm">
                Log out
              </button>
            </form>
          )}
          <a href="/debug" className="u-underline">
            Debug
          </a>
        </nav>
      </div>
    </header>
  );
}
