import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { auth } from "@viu/emporix-sdk";
import { BFF_MAX_AGE, bffCookieJar } from "./bff-cookies";
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
  jar.set(STORAGE_KEYS.customerToken, session.customerToken, BFF_MAX_AGE.customerToken);
  if (session.refreshToken) {
    jar.set(STORAGE_KEYS.refreshToken, session.refreshToken, BFF_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    jar.set(STORAGE_KEYS.saasToken, session.saasToken, BFF_MAX_AGE.saasToken);
  }
  // The guest session is dead weight once a customer token exists — the auth
  // layer always prefers the customer token.
  jar.delete(STORAGE_KEYS.anonymousSession);
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

  jar.set(STORAGE_KEYS.customerToken, session.customerToken, BFF_MAX_AGE.customerToken);
  if (session.refreshToken) {
    jar.set(STORAGE_KEYS.refreshToken, session.refreshToken, BFF_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    jar.set(STORAGE_KEYS.saasToken, session.saasToken, BFF_MAX_AGE.saasToken);
  }
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
  ]) {
    jar.delete(name);
  }
}
