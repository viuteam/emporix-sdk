import {
  STORAGE_KEYS,
  emporixSessionHandle,
  type WithEmporixSessionOptions,
} from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, STORE_OPT, TIMEOUTS } from "../emporix";
import { DEFAULT_LANGUAGE } from "./languages";

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
  if (lang !== undefined) return { ...DEFAULTS, language: lang };
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const language = handle.get(STORAGE_KEYS.language);
  return {
    ...DEFAULTS,
    // `DEFAULT_LANGUAGE`, nicht «Feld weglassen».
    //
    // Hier stand: «Absent, not empty: without the field the SDK sends no
    // `Accept-Language` at all and Emporix falls back to the site's
    // `defaultLanguage` (`de` on `viu`).» Der erste Teil stimmt, der zweite nicht.
    // Gemessen am 2026-08-05: ohne Sprache im Kontext kommt die vollstaendige
    // Sprachkarte zurueck, und `localized()` in examples/shared nimmt daraus den
    // ersten Treffer seiner Reihenfolge — die mit `en` beginnt. Beobachtet im
    // Warenkorb als «Just-in-Time Access (JIT)», waehrend `/de/product/…`
    // «Just-in-Time Zugriff (JIT)» zeigte.
    //
    // Der Tenant-Default IST `de` (`sites.get("main")`, gemessen 2026-08-04) — er
    // wird nur nicht angewandt, wenn niemand danach fragt. Also fragen wir.
    //
    // Greift nur noch, wenn eine Sitzungsroute die erste Anfrage einer Sitzung
    // ueberhaupt ist; sonst hat `proxy.ts` das Cookie schon aus dem Pfad gesetzt.
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
