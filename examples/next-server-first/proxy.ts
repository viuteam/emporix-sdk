import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "./app/emporix";
import { pathLanguage } from "./app/lib/path-language";

/**
 * Rotates the customer token, pins the site — and **closes the seam between the two
 * language sources**.
 *
 * The catalog reads its language from the URL (`/de/category/…`), because a cookie
 * read would make the route dynamic and therefore uncacheable. The session routes
 * (`/cart`, `/checkout`, `/account/…`) read the cookie, because they render per
 * visitor anyway. Two sources, and `/api/session/language` was documented as the only
 * writer.
 *
 * That seam had a hole: **a visitor who never clicks the language switcher has no
 * cookie.** `/` redirects to `DEFAULT_LANGUAGE` without writing it, and landing
 * directly on `/de/product/x` does not write it either. With no cookie the SDK sends
 * no `Accept-Language`, Emporix returns the complete locale map, and `localized()` in
 * examples/shared takes the first hit of its own order — which begins with `en`.
 *
 * Measured on 2026-08-05 against the `viu` tenant: the product page `/de/product/…`
 * showed «Just-in-Time Zugriff (JIT)» while the same item in the cart showed
 * «Just-in-Time Access (JIT)». One call to `/api/session/language?to=de` flipped the
 * cart to German with nothing else changed — which makes the missing cookie the cause,
 * not where the routes live.
 *
 * This is the place to fix it: a proxy may write cookies, a Server Component may not.
 * `emporixSiteProxy` — which `emporixTokenProxy` delegates to — writes the value
 * twice, into the forwarded request cookies (so **this** render already sees it) and as
 * a `Set-Cookie`. This exact case is the example in its own doc comment.
 *
 * Why it does not break the catalog cache: the value is a function of the path, and
 * the path is the cache key — `/de/…` always sets `de`. On top of that
 * `emporixSiteProxy` skips the write when the incoming cookie already matches, so only
 * the first request per language carries a `Set-Cookie` and the steady state carries
 * none.
 *
 * The alternative would be moving the session routes under `/[lang]/…` and deleting
 * the second source entirely. It would fix the same bug, but it moves eight routes and
 * every internal link — and those routes do not become cacheable from it, they still
 * read the session cookie. For URL shape it is the nicer solution; for this bug it is
 * the more expensive one.
 *
 * AN EDGE that does not show on http and is therefore written down: this cookie now
 * has two writers with different naming rules. `emporixSiteProxy` always writes
 * `emporix.language` unprefixed; `emporixSessionHandle` — and with it
 * `/api/session/language` — writes `__Host-emporix.language` on https. Reads go
 * through `readCookie`, which **prefers** the prefixed name and falls back to the bare
 * one. On https an earlier choice made in the switcher therefore wins permanently
 * against the URL: pick DE on `/cart`, then open `/en/product/x`, and the cart stays
 * German.
 *
 * That stays as it is, deliberately. The precedence is fixed in the package and cannot
 * be corrected from this example without reaching for the cookie names — which would
 * be worse than the edge. It needs https, a prior switcher choice, and then a language
 * change by URL rather than by switcher; and on a session route the cookie choice is
 * the only one there is anyway, because no language appears in the URL there.
 */
export async function proxy(request: NextRequest) {
  // `null` on a session route: the existing cookie is then left untouched, because
  // `emporixSiteProxy` leaves an absent field alone. A `/cart` must not overwrite the
  // visitor's choice — it says nothing about language.
  const language = pathLanguage(request.nextUrl.pathname);

  return emporixTokenProxy(request, {
    site: {
      siteCode: "main",
      ...(language !== null ? { language } : {}),
    },
    ...STORE_OPT,
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
