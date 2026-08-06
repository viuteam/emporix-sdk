import { NextResponse, type NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "./app/emporix";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./app/lib/languages";
import { negotiateLanguage } from "./app/lib/negotiate-language";

/**
 * Rotates the customer token, and answers `/`.
 *
 * It used to hold the seam between two language sources: the catalog read the language
 * from the URL, the session routes from a cookie, and this proxy wrote that cookie from
 * the path so the two agreed. There is one source now — the URL — so the write is gone
 * and with it the whole class of failure it caused: a `<Link>` prefetch of another
 * language switching the visitor's language with no click, and on https a switcher
 * choice outranking the URL permanently because two writers disagreed about the
 * `__Host-` prefix.
 *
 * Note what the call below no longer passes: **no `site`**. `emporixSiteProxy` therefore
 * writes nothing, and a cacheable catalog response carries no `Set-Cookie` at all —
 * which it did on every crawl before, because a crawler keeps no cookies.
 *
 * What is left is token rotation, which stays ungated for the reason its own changeset
 * gives: a visitor who navigates client-side for an hour would otherwise never rotate.
 *
 * See `docs/superpowers/specs/2026-08-06-session-routes-under-lang-design.md`.
 */
export async function proxy(request: NextRequest) {
  // `/` cannot be a page any more: with no `app/layout.tsx` there is no root layout to
  // render one into, and a page without one answers 200 with no `<html>` at all —
  // measured 2026-08-06. So the proxy answers it, which is also the only place left
  // that can.
  //
  // 307, not 308: a permanent redirect would be cached by the browser, and which
  // language `/` prefers is configuration plus a request header — not a fact about the
  // URL.
  if (request.nextUrl.pathname === "/") {
    const lang = negotiateLanguage(
      request.headers.get("accept-language"),
      LANGUAGES,
      DEFAULT_LANGUAGE,
    );
    const redirect = NextResponse.redirect(new URL(`/${lang}`, request.url), 307);
    // The target depends on a request header, so say so. This response is not cached,
    // but a shared cache in front must not pin one visitor's negotiation for everybody.
    redirect.headers.set("Vary", "Accept-Language");
    return redirect;
  }

  return emporixTokenProxy(request, STORE_OPT);
}

export const config = {
  // `sitemap.xml` and `icon.svg` join `robots.txt`: they are files for machines, they
  // carry no session and no language, and rotating a token for them is work for nobody.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|icon.svg).*)",
  ],
};
