import type { NextRequest, NextResponse } from "next/server";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { emporixRefresh } from "./bff-auth";
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
 * Reads the `exp` claim without verifying the signature — Emporix verifies it,
 * and a proxy that re-verified would need the signing key for no benefit.
 * Returns `null` for anything unparseable, which the caller treats as expired.
 */
function expiresAt(token: string): number | null {
  const segment = token.split(".")[1];
  if (segment === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
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
    const exp = expiresAt(token);
    const skew = opts.skewSeconds ?? 120;
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
