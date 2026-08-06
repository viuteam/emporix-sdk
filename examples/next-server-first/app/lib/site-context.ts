import { notFound } from "next/navigation";
import {
  STORAGE_KEYS,
  emporixSessionHandle,
  type WithEmporixSessionOptions,
} from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, STORE_OPT, TIMEOUTS } from "../emporix";
import { DEFAULT_LANGUAGE, isLanguage } from "./languages";

/**
 * What a visitor who has chosen nothing gets. This was the module constant
 * `CONTEXT`, and the only reason it is still hard-coded is that the `viu` tenant
 * has exactly one site — measured 2026-08-03: `main`, default, CHF.
 */
const DEFAULTS = { siteCode: "main", currency: "CHF", targetLocation: "CH" } as const;

/**
 * Moved to `./languages` when the catalog routes went to `/[lang]/…`: the list
 * now decides the route table, and `generateStaticParams` must be able to import
 * it without dragging in the server-only session entry.
 */
export { LANGUAGES } from "./languages";

/**
 * The Emporix request context for **this** request, read from the session
 * instead of from a module constant.
 *
 * `emporix.language` is a *public* session key in the sense of
 * `isPublicSessionKey`: it stays an ordinary cookie even in store mode instead of
 * moving into Redis. It is **not** browser-readable here, because everything
 * `emporixSessionHandle` writes is `httpOnly` without exception — measured, after the
 * comment on this function claimed the opposite. That is fine for this demo: the
 * switcher is a Server Component and nothing client-side reads the language. A
 * *client-side* switcher needs the other writer, `emporixSiteProxy`, which writes
 * the same key browser-readable on purpose.
 *
 * **Pass `lang` from a catalog route and this costs nothing at all** — no cookie,
 * no session, no store. That is the whole point of the `/[lang]/…` segment: a
 * `cookies()` read makes a route dynamic for good, and a route that cannot be
 * static cannot be cached by a CDN. Session routes (`/cart`, `/checkout`,
 * `/account/…`) keep reading the cookie, because they are per-visitor anyway and
 * have nothing to gain.
 *
 * The seam between the two sources is held together by the language switcher,
 * which writes the cookie *and* navigates to the prefixed URL.
 */
export async function siteContext(lang?: string): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language?: string;
}> {
  if (lang !== undefined) {
    // BEFORE any Emporix call, and that is the whole point.
    //
    // `[lang]/layout.tsx` has the same check and it is not enough: React renders
    // layout and page concurrently, so the page's `products.get` is already in
    // flight when the layout's `notFound()` runs. Measured 2026-08-06 —
    // `/robots.txt` matches `/[lang]`, the home page sent `Accept-Language:
    // robots.txt`, Emporix answered `400 Language header validation failed`, and
    // the throw beat the notFound(): HTTP 500 instead of 404. Plus a billed
    // request, plus an ISR entry cached for an hour, for every junk URL.
    //
    // Here rather than in each page because every route under `/[lang]/…` calls
    // this before it does anything else, so one check covers all four.
    // `dynamicParams = false` on the layout was the other candidate and is
    // disqualified: measured, it fixes the 500 and 404s every product and
    // category page with it, because it cascades to the child segments.
    if (!isLanguage(lang)) notFound();
    return { ...DEFAULTS, language: lang };
  }
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const language = handle.get(STORAGE_KEYS.language);
  return {
    ...DEFAULTS,
    // `DEFAULT_LANGUAGE`, not "leave the field out".
    //
    // This used to read: «Absent, not empty: without the field the SDK sends no
    // `Accept-Language` at all and Emporix falls back to the site's
    // `defaultLanguage` (`de` on `viu`).» The first half is true, the second is not.
    // Measured 2026-08-05: with no language in the context the complete locale map
    // comes back, and `localized()` in examples/shared takes the first hit of its
    // own order — which begins with `en`. Observed in the cart as «Just-in-Time
    // Access (JIT)» while `/de/product/…` showed «Just-in-Time Zugriff (JIT)».
    //
    // The tenant default IS `de` (`sites.get("main")`, measured 2026-08-04) — it
    // just never gets applied unless somebody asks for it. So we ask.
    //
    // Only bites now when a session route is the very first request of a session;
    // otherwise `proxy.ts` has already set the cookie from the path.
    language: language ?? DEFAULT_LANGUAGE,
  };
}

/** The same thing for the session calls. Replaces the exported `EMPORIX`. */
export async function emporixOptions(): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(),
    timeouts: TIMEOUTS,
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
