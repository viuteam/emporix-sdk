import { STORAGE_KEYS } from "@viu/emporix-sdk";
import { auth, type CustomerSession } from "@viu/emporix-sdk";
import { reportEmporixError } from "./error-reporting";
import {
  SESSION_ABSOLUTE_MAX,
  SESSION_EXPIRES_AT,
  SESSION_FALLBACK_LIFETIME,
  SESSION_MAX_AGE,
  SESSION_STARTED_AT,
  emporixSessionHandle,
  type EmporixSessionHandle,
} from "./session-cookies";
import { withEmporixSessionMutable, type WithEmporixSessionOptions } from "./session-client";

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

  // `opts.store` matters here, not just in `withEmporixSessionMutable`. Without
  // it this handle is a cookie handle however the caller was configured, so store mode
  // wrote the tokens into the browser while every reader looked in the store and
  // found nothing. Spread conditionally: exactOptionalPropertyTypes rejects
  // `{ store: undefined }`.
  const handle = await emporixSessionHandle(opts.store !== undefined ? { store: opts.store } : {});
  persistSession(handle, session);
  // The ceiling starts here and is never rewritten — see SESSION_STARTED_AT.
  handle.set(SESSION_STARTED_AT, String(Math.floor(Date.now() / 1000)), SESSION_ABSOLUTE_MAX);
  // Flush BEFORE onboarding, and this is not an optimisation.
  //
  // `onboardCart` calls `withEmporixSessionMutable`, which builds its OWN handle and
  // branches on whether a customer token is stored. In cookie mode `persistSession`
  // above wrote through, so that handle sees the token and takes the customer path.
  // In store mode it only touched the in-memory record — so without this flush the
  // second handle reads a store that has no customer token yet and runs as a GUEST.
  //
  // Measured on 2026-08-03 with instrumentation inside `onboardCart`:
  //   authKind=anonymous  getCurrent=<a NEW empty cart>  customerIdOnCart=(none)
  //   merge FAILED: cart.merge requires a { kind: 'customer' } AuthContext
  //
  // Two consequences, both shopper-visible: `getCurrent` created a fresh anonymous
  // cart instead of finding the customer's, and the merge never reached Emporix —
  // the SDK's own `requireCustomerAuth` rejected it. So a guest who logged in
  // landed on an empty cart, in store mode only.
  await handle.flush();
  // Must run AFTER persistSession: it resolves through the customer token this
  // just wrote, and BEFORE the anonymous session is dropped.
  await onboardCart(handle, opts);
  // The guest session is dead weight once a customer token exists — the auth
  // layer always prefers the customer token.
  handle.delete(STORAGE_KEYS.anonymousSession);
  await handle.flush();
}

/**
 * Adopts the customer's cart and folds the guest cart into it.
 *
 * Without this a customer whose cart cookie is absent — after a checkout closed
 * the previous cart, or after the cookie expired — falls through to
 * `carts.create`, and Emporix answers **409 Conflict**: a customer may hold only
 * one open cart. `getCurrent({ create: true })` returns the existing one or
 * makes the first.
 *
 * Mirrors `onboardCustomerCart` in `@viu/emporix-sdk-react`, which is what gives
 * the SPA mode the same behaviour. Skipped without a `siteCode`, because
 * `getCurrent` requires one.
 *
 * Best-effort by design: a login must not fail because a cart is in a bad state.
 */
async function onboardCart(
  handle: EmporixSessionHandle,
  opts: WithEmporixSessionOptions,
): Promise<void> {
  const siteCode = opts.context?.siteCode;
  if (siteCode === undefined) return;
  try {
    await withEmporixSessionMutable(async (client, ctx) => {
      const cart = await client.carts.getCurrent(ctx, { siteCode, create: true });
      const customerCartId = cart?.id;
      if (customerCartId === undefined) return;
      const guestCartId = handle.get(STORAGE_KEYS.cartId);

      if (guestCartId !== null && guestCartId !== customerCartId) {
        // NO try/catch here, deliberately. A merge that fails must abort before
        // the `handle.set` below, so the session keeps pointing at the guest cart
        // rather than moving the shopper onto a cart their items are not in.
        // Catching it and writing the id anyway was tried on 2026-08-03 and
        // reverted the same day: it put the shopper on `0 item(s)`.
        //
        // The path id is the CUSTOMER cart (the target); the body lists the
        // anonymous carts merged into it. Easy to invert.
        await client.carts.merge(customerCartId, [guestCartId], ctx);
      }
      handle.set(STORAGE_KEYS.cartId, customerCartId, SESSION_MAX_AGE.cartId);
    }, opts);
  } catch (cause) {
    // Ignore — the customer is logged in either way. Unchanged, but a failure
    // here silently drops the guest cart, so it no longer passes unremarked.
    reportEmporixError({
      code: "session.cart_onboarding_failed",
      degradedTo: "customer is logged in, but their guest cart was not carried over",
      cause,
    });
  }
}

/**
 * Writes the session cookies, including the absolute expiry the proxy needs.
 *
 * The expiry is stored rather than derived, because the Emporix customer access
 * token is **opaque** — only the `saasToken` is a JWT. Without this the proxy
 * has nothing to compare against and would refresh on every single request.
 */
function persistSession(handle: EmporixSessionHandle, session: CustomerSession): void {
  handle.set(STORAGE_KEYS.customerToken, session.customerToken, SESSION_MAX_AGE.customerToken);
  const lifetime = session.expiresIn ?? SESSION_FALLBACK_LIFETIME;
  handle.set(
    SESSION_EXPIRES_AT,
    String(Math.floor(Date.now() / 1000) + lifetime),
    SESSION_MAX_AGE.customerToken,
  );
  if (session.refreshToken) {
    handle.set(STORAGE_KEYS.refreshToken, session.refreshToken, SESSION_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    handle.set(STORAGE_KEYS.saasToken, session.saasToken, SESSION_MAX_AGE.saasToken);
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
  // `opts.store` matters here, not just in `withEmporixSessionMutable`. Without
  // it this handle is a cookie handle however the caller was configured, so store mode
  // wrote the tokens into the browser while every reader looked in the store and
  // found nothing. Spread conditionally: exactOptionalPropertyTypes rejects
  // `{ store: undefined }`.
  const handle = await emporixSessionHandle(opts.store !== undefined ? { store: opts.store } : {});
  const startedAt = stampedAt(handle.get(SESSION_STARTED_AT));
  if (startedAt === null) {
    // A session from before this shipped carries no stamp. Adopt it rather
    // than logging the customer out on deploy.
    handle.set(SESSION_STARTED_AT, String(Math.floor(Date.now() / 1000)), SESSION_ABSOLUTE_MAX);
  } else if (Math.floor(Date.now() / 1000) - startedAt > SESSION_ABSOLUTE_MAX) {
    // The ceiling. Refusing here rather than letting the refresh succeed is
    // the whole control: the idle window slides, this does not.
    clearSession(handle);
    // clearSession empties the record; destroy also drops the store entry and
    // the sid cookie. Both are needed — destroy is a no-op in cookie mode.
    await handle.destroy();
    return null;
  }
  const refreshToken = handle.get(STORAGE_KEYS.refreshToken);
  if (refreshToken === null) return null;
  const saasToken = handle.get(STORAGE_KEYS.saasToken);
  const legalEntityId = handle.get(STORAGE_KEYS.activeLegalEntityId);

  const session = await withEmporixSessionMutable(
    (client) =>
      client.customers.refresh({
        refreshToken,
        ...(saasToken !== null ? { saasToken } : {}),
        ...(legalEntityId !== null ? { legalEntityId } : {}),
      }),
    opts,
  );

  persistSession(handle, session);
  await handle.flush();
  return session.customerToken;
}

/**
 * Every cookie a session owns.
 *
 * One list, because logout and the absolute ceiling both clear it — two copies
 * would drift the moment someone adds a cookie.
 */
const SESSION_COOKIES = [
  STORAGE_KEYS.customerToken,
  STORAGE_KEYS.refreshToken,
  STORAGE_KEYS.saasToken,
  STORAGE_KEYS.cartId,
  STORAGE_KEYS.activeLegalEntityId,
  STORAGE_KEYS.anonymousSession,
  SESSION_EXPIRES_AT,
  SESSION_STARTED_AT,
] as const;

function clearSession(handle: EmporixSessionHandle): void {
  for (const name of SESSION_COOKIES) handle.delete(name);
}

/**
 * The stored session start, epoch seconds, or `null` when absent or unusable.
 *
 * Explicit about `null` rather than leaning on `Number()`: `Number(null)` is
 * **0**, not `NaN`, so a missing stamp would read as «started at the epoch» and
 * every session without one would hit the ceiling immediately. Same trap
 * `storedExpiry` avoids in the token proxy.
 */
function stampedAt(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Invalidates the session server-side, then clears every secret cookie.
 *
 * The local clear happens regardless of the server call's outcome — the token
 * may already be expired, and leaving a dead cookie behind is worse than a
 * failed invalidation.
 */
export async function emporixLogout(opts: WithEmporixSessionOptions = {}): Promise<void> {
  // `opts.store` matters here, not just in `withEmporixSessionMutable`. Without
  // it this handle is a cookie handle however the caller was configured, so store mode
  // wrote the tokens into the browser while every reader looked in the store and
  // found nothing. Spread conditionally: exactOptionalPropertyTypes rejects
  // `{ store: undefined }`.
  const handle = await emporixSessionHandle(opts.store !== undefined ? { store: opts.store } : {});
  const token = handle.get(STORAGE_KEYS.customerToken);
  if (token !== null) {
    try {
      await withEmporixSessionMutable(
        (client) => client.customers.logout(auth.customer(token)),
        opts,
      );
    } catch (cause) {
      // Ignore — proceed to clear locally. The local session goes either way,
      // but the token stays valid at Emporix until it expires on its own.
      reportEmporixError({
        code: "session.logout_upstream_failed",
        degradedTo: "local session cleared; the customer token was not invalidated upstream",
        cause,
        severity: "warning",
      });
    }
  }
  clearSession(handle);
  await handle.destroy();
}
