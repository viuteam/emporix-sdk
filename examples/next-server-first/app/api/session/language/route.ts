import { STORAGE_KEYS, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../../../emporix";
import { isLanguage } from "../../../lib/languages";
import { safeNext } from "../../../lib/safe-next";

/** A year: a language choice is a preference, not a session. Same value the
 *  package's `emporixSiteProxy` uses for this cookie. */
const LANGUAGE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The one place where the two language sources are reconciled — now both ways.
 *
 * Catalog routes read the language from their URL (`/de/category/…`), because a
 * cookie read would make them dynamic and uncacheable. Session routes (`/cart`,
 * `/checkout`, `/account/…`) keep reading the cookie, because they are
 * per-visitor anyway. That seam needs exactly one writer, and this is it.
 *
 * Two modes, told apart by the `to` parameter:
 *
 * - **`?to=<lang>` → write.** Set the cookie, then redirect to `next`. A GET
 *   behind a plain `<a>` rather than a Server Action, so switching works with
 *   JavaScript disabled. Safe as a GET because it writes a display preference,
 *   not state anyone could be tricked into changing usefully.
 * - **no `to` → read.** Return the chosen language as JSON. The switcher needs
 *   this on a session route: the language cookie is `httpOnly`, so the client
 *   cannot read it to know which chip is active. Catalog routes never call this —
 *   they read the language from their URL.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const to = url.searchParams.get("to");

  if (to === null) {
    // Read mode. `null` when the visitor has made no choice yet — the switcher
    // then frames nothing rather than guess.
    const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
    const current = handle.get(STORAGE_KEYS.language);
    return Response.json(
      { language: current !== null && isLanguage(current) ? current : null },
      // Per visitor, so it must never sit in a shared cache — same rule as
      // `/api/session/nav`.
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Write mode. An allowlist, not free text: this value ends up in a cookie and
  // from there in the `Accept-Language` header of every Emporix request the
  // session makes.
  if (!isLanguage(to)) {
    return new Response("unsupported language", { status: 400 });
  }
  // Own paths only — `?next=https://evil.com` would turn the language switcher
  // into an open redirect. `safeNext` keeps a query string, so a switch on
  // `/search?q=…` lands back on the same results.
  const next = safeNext(url.searchParams.get("next") ?? undefined);

  const handle = await emporixSessionHandle(STORE_OPT);
  handle.set(STORAGE_KEYS.language, to, LANGUAGE_MAX_AGE);
  await handle.flush();

  return Response.redirect(new URL(next, url.origin), 303);
}
