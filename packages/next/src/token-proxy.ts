import type { NextRequest, NextResponse } from "next/server";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { emporixRefresh } from "./bff-auth";
import { BFF_EXPIRES_AT } from "./bff-cookies";
import { emporixSiteProxy, type EmporixSite } from "./proxy";

export interface EmporixTokenProxyOptions {
  /** Forwarded to `emporixSiteProxy`. */
  site?: EmporixSite;
  /** Forwarded to `emporixSiteProxy`. */
  rewriteTo?: string | URL;
  /** Refresh when the access token expires within this many seconds. Default 120. */
  skewSeconds?: number;
}

/**
 * The stored absolute expiry, epoch seconds, or `null` when absent or unusable.
 *
 * The Emporix customer access token is **opaque** — only the `saasToken` is a
 * JWT — so there is no `exp` claim to read off it. `emporixLogin` and
 * `emporixRefresh` persist the lifetime Emporix returns instead.
 */
function storedExpiry(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The single token-rotation point for the server-first mode.
 *
 * A Server Component render cannot write cookies, so it cannot rotate a token —
 * and a rotation whose result is not persisted is worthless. The proxy can do
 * both, and it runs before every render, so every Server Component sees a fresh
 * token. That also makes it irrelevant whether Emporix invalidates the old
 * refresh token on use: the rotated one is always written.
 *
 * Delegates site and language to {@link emporixSiteProxy}, so a storefront needs
 * one proxy function rather than two.
 *
 * @example
 * ```ts
 * // proxy.ts
 * export async function proxy(request: NextRequest) {
 *   return emporixTokenProxy(request, { site: { siteCode: "main" } });
 * }
 * ```
 */
export async function emporixTokenProxy(
  request: NextRequest,
  opts: EmporixTokenProxyOptions = {},
): Promise<NextResponse> {
  const token = request.cookies.get(STORAGE_KEYS.customerToken)?.value;
  if (token !== undefined) {
    const exp = storedExpiry(request.cookies.get(BFF_EXPIRES_AT)?.value);
    const skew = opts.skewSeconds ?? 120;
    // A missing expiry refreshes ONCE and then self-heals, because the refresh
    // writes the cookie. Refreshing on every request instead — which is what
    // parsing a non-existent `exp` claim did — hammers Emporix and rotates the
    // access token on every page view.
    const stale = exp === null || exp - Math.floor(Date.now() / 1000) <= skew;
    if (stale) {
      const fresh = await emporixRefresh();
      if (fresh !== null) {
        // Make the fresh token visible to THIS render, not just the next one.
        // emporixRefresh already persisted it through the cookie jar.
        request.cookies.set(STORAGE_KEYS.customerToken, fresh);
      }
    }
  }
  return emporixSiteProxy(request, opts.site ?? {}, opts.rewriteTo);
}
