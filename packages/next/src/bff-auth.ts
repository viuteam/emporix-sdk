import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { auth, type CustomerSession } from "@viu/emporix-sdk";
import {
  BFF_EXPIRES_AT,
  BFF_FALLBACK_LIFETIME,
  BFF_MAX_AGE,
  bffCookieJar,
  type BffCookieJar,
} from "./bff-cookies";
import { withEmporixSessionMutable, type WithEmporixSessionOptions } from "./bff-session";

/**
 * Rejects a request that did not originate from this site.
 *
 * `sameSite: "lax"` already stops a cross-site POST at the browser; this is the
 * second, independent layer, and it lives in the package so a consumer cannot
 * forget it. A request carrying neither `Sec-Fetch-Site` nor `Origin` is
 * rejected too — otherwise omitting the header would be the bypass. That also
 * rejects non-browser clients, which is correct for these routes.
 */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site === "cross-site") {
      throw new Error("assertSameOrigin: rejected a cross-site request");
    }
    return;
  }
  const origin = request.headers.get("origin");
  if (origin === null) {
    throw new Error(
      "assertSameOrigin: request carries neither Sec-Fetch-Site nor Origin; refusing to guess",
    );
  }
  if (new URL(origin).origin !== new URL(request.url).origin) {
    throw new Error("assertSameOrigin: rejected a cross-origin request");
  }
}

/**
 * Logs a customer in and stores the session in httpOnly cookies.
 *
 * Returns `void` on purpose: nothing a caller could serialize into a response
 * body. The browser learns it is logged in from the next render, not from a
 * token.
 *
 * Threads the guest's anonymous token so the cart survives the login — Emporix
 * creates a new session otherwise, and the cart is bound to the session.
 */
export async function emporixLogin(
  creds: { email: string; password: string },
  opts: WithEmporixSessionOptions = {},
): Promise<void> {
  // No explicit `{ anonymousToken }`: the default `auth.anonymous()` resolves
  // through THIS client's token provider, which the guest path already seeded
  // from the guest's own session cookie. Passing it again would be the same
  // token by a longer route. The SDK option exists for callers who hold a token
  // the client does not — the browser case, not this one.
  const session = await withEmporixSessionMutable(
    (client) => client.customers.login(creds),
    opts,
  );

  const jar = await bffCookieJar();
  persistSession(jar, session);
  // The guest session is dead weight once a customer token exists — the auth
  // layer always prefers the customer token.
  jar.delete(STORAGE_KEYS.anonymousSession);
}

/**
 * Writes the session cookies, including the absolute expiry the proxy needs.
 *
 * The expiry is stored rather than derived, because the Emporix customer access
 * token is **opaque** — only the `saasToken` is a JWT. Without this the proxy
 * has nothing to compare against and would refresh on every single request.
 */
function persistSession(jar: BffCookieJar, session: CustomerSession): void {
  jar.set(STORAGE_KEYS.customerToken, session.customerToken, BFF_MAX_AGE.customerToken);
  const lifetime = session.expiresIn ?? BFF_FALLBACK_LIFETIME;
  jar.set(
    BFF_EXPIRES_AT,
    String(Math.floor(Date.now() / 1000) + lifetime),
    BFF_MAX_AGE.customerToken,
  );
  if (session.refreshToken) {
    jar.set(STORAGE_KEYS.refreshToken, session.refreshToken, BFF_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    jar.set(STORAGE_KEYS.saasToken, session.saasToken, BFF_MAX_AGE.saasToken);
  }
}

/**
 * Rotates the customer session from the httpOnly refresh cookie.
 *
 * Returns the fresh access token so the proxy can decide whether to continue,
 * or `null` when there is nothing to refresh. The refresh endpoint does not
 * re-mint the `saasToken`, so the stored one is carried forward.
 */
export async function emporixRefresh(
  opts: WithEmporixSessionOptions = {},
): Promise<string | null> {
  const jar = await bffCookieJar();
  const refreshToken = jar.get(STORAGE_KEYS.refreshToken);
  if (refreshToken === null) return null;
  const saasToken = jar.get(STORAGE_KEYS.saasToken);
  const legalEntityId = jar.get(STORAGE_KEYS.activeLegalEntityId);

  const session = await withEmporixSessionMutable(
    (client) =>
      client.customers.refresh({
        refreshToken,
        ...(saasToken !== null ? { saasToken } : {}),
        ...(legalEntityId !== null ? { legalEntityId } : {}),
      }),
    opts,
  );

  persistSession(jar, session);
  return session.customerToken;
}

/**
 * Invalidates the session server-side, then clears every secret cookie.
 *
 * The local clear happens regardless of the server call's outcome — the token
 * may already be expired, and leaving a dead cookie behind is worse than a
 * failed invalidation.
 */
export async function emporixLogout(opts: WithEmporixSessionOptions = {}): Promise<void> {
  const jar = await bffCookieJar();
  const token = jar.get(STORAGE_KEYS.customerToken);
  if (token !== null) {
    try {
      await withEmporixSessionMutable(
        (client) => client.customers.logout(auth.customer(token)),
        opts,
      );
    } catch {
      // Ignore — proceed to clear locally.
    }
  }
  for (const name of [
    STORAGE_KEYS.customerToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.saasToken,
    STORAGE_KEYS.cartId,
    STORAGE_KEYS.activeLegalEntityId,
    STORAGE_KEYS.anonymousSession,
    BFF_EXPIRES_AT,
  ]) {
    jar.delete(name);
  }
}
