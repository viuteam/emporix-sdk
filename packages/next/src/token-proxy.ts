import type { NextRequest, NextResponse } from "next/server";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { emporixRefresh } from "./session-auth";
import { SESSION_EXPIRES_AT } from "./session-cookies";
import { cookieName, readCookie, sealCookie } from "./cookie-name";
import { SESSION_SID, type EmporixSessionStore } from "./session-store";
import { emporixSiteProxy, type EmporixSite } from "./proxy";

export interface EmporixTokenProxyOptions {
  /** Forwarded to `emporixSiteProxy`. */
  site?: EmporixSite;
  /** Forwarded to `emporixSiteProxy`. */
  rewriteTo?: string | URL;
  /** Refresh when the access token expires within this many seconds. Default 120. */
  skewSeconds?: number;
  /**
   * The session store, when one is configured. Without it the proxy reads the
   * token from cookies — which in store mode would find only a sid and would
   * never refresh anything.
   */
  store?: EmporixSessionStore;
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
  // This runs in a proxy, where `cookies()` does not exist — so it reads
  // `request.cookies` directly and has to repeat the name and codec rules
  // rather than going through the jar. Same derivation emporixSiteProxy uses.
  const secure = request.nextUrl.protocol === "https:";
  const tokenCookie = cookieName(STORAGE_KEYS.customerToken, secure);
  const read = (wire: string): string | undefined => request.cookies.get(wire)?.value;

  // In store mode the cookies hold nothing but a sid, so the token has to come
  // from the record. The jar is unavailable here — `cookies()` does not exist in
  // a proxy — so this reads the store directly.
  let token: string | null;
  let expiryRaw: string | null;
  if (opts.store !== undefined) {
    const sid = readCookie(SESSION_SID, read);
    const record = sid === null ? null : await opts.store.read(sid).catch(() => null);
    token = record?.[STORAGE_KEYS.customerToken] ?? null;
    expiryRaw = record?.[SESSION_EXPIRES_AT] ?? null;
  } else {
    token = readCookie(STORAGE_KEYS.customerToken, read);
    expiryRaw = readCookie(SESSION_EXPIRES_AT, read);
  }

  if (token !== null) {
    const exp = storedExpiry(expiryRaw ?? undefined);
    const skew = opts.skewSeconds ?? 120;
    // A missing expiry refreshes ONCE and then self-heals, because the refresh
    // writes the cookie. Refreshing on every request instead — which is what
    // parsing a non-existent `exp` claim did — hammers Emporix and rotates the
    // access token on every page view.
    const stale = exp === null || exp - Math.floor(Date.now() / 1000) <= skew;
    if (stale) {
      const fresh = await emporixRefresh(
        opts.store !== undefined ? { store: opts.store } : {},
      );
      if (fresh !== null && opts.store === undefined) {
        // Cookie mode only: make the fresh token visible to THIS render, not
        // just the next one. In store mode emporixRefresh already wrote the
        // record and the render reads the record — there is nothing to inject.
        request.cookies.set(tokenCookie, sealCookie(STORAGE_KEYS.customerToken, fresh));
      }
    }
  }
  return emporixSiteProxy(request, opts.site ?? {}, opts.rewriteTo);
}
