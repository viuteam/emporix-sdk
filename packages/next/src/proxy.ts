import { NextResponse, type NextRequest } from "next/server";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";

/**
 * The site and language a proxy resolved for one request.
 *
 * An absent field is left alone — there is no delete. Call
 * `response.cookies.delete` yourself if you need one gone.
 */
export interface EmporixSite {
  siteCode?: string;
  language?: string;
}

const ENTRIES = [
  ["siteCode", STORAGE_KEYS.siteCode],
  ["language", STORAGE_KEYS.language],
] as const;

/** One year. A site/language choice is a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Persists a resolved site/language for one request, from a Next 16 `proxy.ts`.
 *
 * Writes each changed value twice, and both writes are needed:
 * - into the **forwarded request** cookies, so `emporixSession()` sees it in
 *   this very render rather than the next one;
 * - as a browser-readable **`Set-Cookie`**, so `createCookieStorage` seeds the
 *   client `SiteContextProvider` and the hydration query key matches the one
 *   the server prefetched with.
 *
 * A value equal to the incoming cookie is skipped entirely, so a returning
 * visitor gets no `Set-Cookie` at all.
 *
 * A resolved value that differs from the incoming cookie **wins**. If a
 * client-side language switch must survive, read `request.cookies` in your
 * resolver and return the value already there — whether the URL or the user's
 * choice wins is a product decision, not this function's.
 *
 * Deliberately does not touch the Emporix API or `getEmporixClient`: the Next
 * docs say proxy code must not rely on shared modules or globals, and
 * `getEmporixClient` memoizes in a module-level map.
 *
 * @param rewriteTo Omit for a pass-through (`NextResponse.next`). A relative
 *   string is resolved against `request.url`. Redirects do not need this
 *   function: there is no render to inject headers into, and the `Set-Cookie`
 *   travels with the redirect.
 *
 * @example
 * ```ts
 * // proxy.ts
 * export function proxy(request: NextRequest) {
 *   const seg = request.nextUrl.pathname.split("/")[1] ?? "";
 *   return emporixSiteProxy(request, {
 *     siteCode: "main",
 *     ...(LANGS.has(seg) ? { language: seg } : {}),
 *   });
 * }
 * ```
 */
export function emporixSiteProxy(
  request: NextRequest,
  site: EmporixSite,
  rewriteTo?: string | URL,
): NextResponse {
  const changed: Array<[string, string]> = [];
  for (const [field, name] of ENTRIES) {
    const value = site[field];
    if (value === undefined) continue;
    if (request.cookies.get(name)?.value === value) continue;
    // Writes back the request's `cookie` header — see
    // next/dist/compiled/@edge-runtime/cookies/index.js:212-217.
    request.cookies.set(name, value);
    changed.push([name, value]);
  }

  // `{ request: { headers } }`, NOT `{ headers }`: the former forwards to the
  // render, the latter would send them to the client.
  const init = { request: { headers: request.headers } };
  const response =
    rewriteTo === undefined
      ? NextResponse.next(init)
      : NextResponse.rewrite(new URL(rewriteTo, request.url), init);

  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
      path: "/",
      sameSite: "lax",
      // NOT httpOnly, on purpose and unlike `emporixSessionMutable`: the
      // browser-side createCookieStorage must read these two, or the storage
      // precedence step in SiteContextProvider never fires.
      httpOnly: false,
      // Derived, not hard `true`: hard `true` silently drops the cookie on an
      // HTTP staging host, which is fail-closed and miserable to diagnose.
      // Behind a TLS-terminating reverse proxy Next reports `http:` and no
      // `Secure` is set — fail-open, and the cookie still works.
      secure: request.nextUrl.protocol === "https:",
      maxAge: MAX_AGE,
    });
  }
  return response;
}
