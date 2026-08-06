import { notFound } from "next/navigation";
import { type WithEmporixSessionOptions } from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, TIMEOUTS } from "../emporix";
import { DEFAULT_LANGUAGE, isLanguage } from "./languages";

/**
 * What a visitor who has chosen nothing gets. This was the module constant `CONTEXT`,
 * and the only reason it is still hard-coded is that the `viu` tenant has exactly one
 * site — measured 2026-08-03: `main`, default, CHF.
 */
const DEFAULTS = { siteCode: "main", currency: "CHF", targetLocation: "CH" } as const;

/**
 * Moved to `./languages` when the catalog routes went to `/[lang]/…`: the list now
 * decides the route table, and `generateStaticParams` must be able to import it without
 * dragging in the server-only session entry.
 */
export { LANGUAGES } from "./languages";

/**
 * The Emporix request context for this request.
 *
 * `lang` comes from the URL — `params.lang` — and every page has it, because every page
 * lives under `[lang]`. It used to be readable from a cookie as well, and that second
 * source is what this file's history is mostly about: two writers with different naming
 * rules, a `<Link>` prefetch able to change it, and an https edge where a switcher
 * choice outranked the URL for good. There is no cookie here now, and this function
 * makes no session read at all — which is also why every route that calls it can stay
 * static.
 *
 * The parameter stays **optional** and falls back to `DEFAULT_LANGUAGE` — a constant, not
 * a second source of truth. Counted 2026-08-06: 23 call sites asked for the context with
 * no language, most of them Server Actions that mutate and redirect rather than render.
 * Threading a parameter through all 23 would be a large mechanical diff for a difference
 * nobody sees; the pages that *do* render localized content all pass it. The wart that
 * leaves, named rather than hidden: an Emporix error surfaced by a cart or account action
 * can arrive in the default language on a page in the other one.
 */
export async function siteContext(lang?: string): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language: string;
}> {
  // BEFORE any Emporix call, and that is the whole point.
  //
  // `[lang]/layout.tsx` has the same check and it is not enough: React renders layout
  // and page concurrently, so the page's `products.get` is already in flight when the
  // layout's `notFound()` runs. Measured 2026-08-06 — `/robots.txt` matches `/[lang]`,
  // the home page sent `Accept-Language: robots.txt`, Emporix answered `400 Language
  // header validation failed`, and the throw beat the notFound(): HTTP 500 instead of
  // 404. Plus a billed request, plus an ISR entry cached for an hour, for every junk URL.
  //
  // Here rather than in each page because every route under `/[lang]/…` calls this
  // before it does anything else, so one check covers all of them. `dynamicParams =
  // false` on the layout was the other candidate and is disqualified: measured, it fixes
  // the 500 and 404s every product and category page with it, because it cascades to the
  // child segments.
  if (lang !== undefined && !isLanguage(lang)) notFound();
  return { ...DEFAULTS, language: lang ?? DEFAULT_LANGUAGE };
}

/** The same thing for the session calls. Replaces the exported `EMPORIX`. */
export async function emporixOptions(lang?: string): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(lang),
    timeouts: TIMEOUTS,
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
