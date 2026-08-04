import {
  STORAGE_KEYS,
  emporixSessionHandle,
  type WithEmporixSessionOptions,
} from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, STORE_OPT } from "../emporix";

/**
 * What a visitor who has chosen nothing gets. This was the module constant
 * `CONTEXT`, and the only reason it is still hard-coded is that the `viu` tenant
 * has exactly one site — measured 2026-08-03: `main`, default, CHF.
 */
const DEFAULTS = { siteCode: "main", currency: "CHF", targetLocation: "CH" } as const;

/**
 * The languages this demo offers.
 *
 * Not invented: `client.sites.get("main")` on the `viu` tenant returns
 * `languages: ["en", "de"], defaultLanguage: "de"`. It stays a literal because
 * the switcher lives in the header, and the header makes zero Emporix calls —
 * that invariant is worth more than a self-configuring dropdown. A multi-site app
 * reads the list from the site and caches it under the `emporix:sites` tag.
 *
 * It lives **here** and not next to `switchLanguage`, because a `"use server"`
 * file may only export async functions — an exported array there fails the build
 * with «can only export async functions, found object».
 */
export const LANGUAGES = ["en", "de"] as const;

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
 * Costs no Emporix call. Every page here is already dynamic because the header
 * reads the cart count from the session, so one more cookie read changes nothing
 * about how the route renders.
 */
export async function siteContext(): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language?: string;
}> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const language = handle.get(STORAGE_KEYS.language);
  return {
    ...DEFAULTS,
    // Absent, not empty: without the field the SDK sends no `Accept-Language` at
    // all and Emporix falls back to the site's `defaultLanguage` (`de` on `viu`).
    ...(language !== null ? { language } : {}),
  };
}

/** The same thing for the session calls. Replaces the exported `EMPORIX`. */
export async function emporixOptions(): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(),
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
