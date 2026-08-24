import {
  EmporixClient,
  auth,
  type AnonymousSessionStore,
  type AuthContext,
  type StoredAnonymousSession,
} from "@viu/emporix-sdk";
import { STORAGE_KEYS } from "@viu/emporix-sdk";
import { getEmporixClient } from "./client";
import { SESSION_MAX_AGE, emporixSessionHandle, type EmporixSessionHandle } from "./session-cookies";
import { reportEmporixError } from "./error-reporting";
import type { EmporixSessionStore } from "./session-store";

export interface WithEmporixSessionOptions {
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_STOREFRONT_CLIENT_ID`. */
  clientId?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
  /**
   * Keeps session values server-side instead of in cookies. Without it they
   * live in cookies, which still works — see the README.
   *
   * Must be passed to `emporixTokenProxy` and `emporixSession` as well. Forget
   * it in one place and that place silently falls back to cookie mode.
   */
  store?: EmporixSessionStore;
  /**
   * Per-request budgets, forwarded to the SDK.
   *
   * The SDK default is 10 s to headers and 60 s to the end of the body.
   * Generous, and at high concurrency that is the problem: a slow upstream holds
   * a socket and an event-loop task for a minute per request, so one slow
   * Emporix minute fills the process with parked work before anything gives up.
   * Pick something a visitor would actually wait for.
   */
  timeouts?: { connectMs?: number; readMs?: number };
  /** Bound at anonymous login. Must match what the rest of the app binds. */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
}

/**
 * Persists the anonymous session in an httpOnly cookie, per guest.
 *
 * The access token is kept alongside the refresh token, and that is what makes a
 * guest page view cost **zero** token calls instead of one. A guest client lives
 * for one request, so without the token every request redeemed the refresh token
 * for a token it already had — measured against the `viu` tenant, an anonymous
 * token is valid for 3599 seconds, which is most of a browsing session.
 *
 * It adds no exposure: the cookie is httpOnly (and sealed when
 * `EMPORIX_COOKIE_SECRET` is set), and whoever holds the refresh token that has
 * always lived here can mint an access token at will. The token itself is 28
 * opaque characters on this tenant — no meaningful cookie-size cost.
 */
function anonymousStore(handle: EmporixSessionHandle): AnonymousSessionStore {
  return {
    read: () => {
      const raw = handle.get(STORAGE_KEYS.anonymousSession);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<StoredAnonymousSession>;
        if (typeof parsed.refreshToken !== "string" || typeof parsed.sessionId !== "string") {
          return null;
        }
        // Both extra fields are validated and carried only together: the SDK
        // ignores an expiry without a token, and a token without an expiry is
        // treated as stale. A cookie written before this existed simply has
        // neither, and still refreshes as it always did.
        const hasToken = typeof parsed.accessToken === "string" && parsed.accessToken.length > 0;
        const hasExpiry = typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt);
        return {
          refreshToken: parsed.refreshToken,
          sessionId: parsed.sessionId,
          ...(hasToken && hasExpiry
            ? { accessToken: parsed.accessToken!, expiresAt: parsed.expiresAt! }
            : {}),
        };
      } catch (cause) {
        reportEmporixError({
          code: "session.anonymous_cookie_unparseable",
          degradedTo: "guest reads as having no anonymous session and gets a fresh one",
          cause,
          severity: "warning",
        });
        return null;
      }
    },
    write: (session) => {
      if (session === null) {
        handle.delete(STORAGE_KEYS.anonymousSession);
        return;
      }
      handle.set(
        STORAGE_KEYS.anonymousSession,
        JSON.stringify({
          refreshToken: session.refreshToken,
          sessionId: session.sessionId,
          ...(session.accessToken !== undefined ? { accessToken: session.accessToken } : {}),
          ...(session.expiresAt !== undefined ? { expiresAt: session.expiresAt } : {}),
        }),
        SESSION_MAX_AGE.anonymousSession,
      );
    },
  };
}

/**
 * A client per request, for the guest path only.
 *
 * `getEmporixClient()` is memoized per process, so attaching a request-scoped
 * anonymous store to it would leak one guest's session to the next. Emporix maps
 * the anonymous token's `session-id` onto the cart when the cart is created, so
 * a shared guest session means a shared cart.
 */
function newGuestClient(opts: WithEmporixSessionOptions): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error("withEmporixSession: no tenant. Set EMPORIX_TENANT or pass { tenant }.");
  }
  const clientId = opts.clientId ?? process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "withEmporixSession: no storefront client id. Set EMPORIX_STOREFRONT_CLIENT_ID or pass { clientId }.",
    );
  }
  const host = opts.host ?? process.env.EMPORIX_HOST;
  return new EmporixClient({
    tenant,
    credentials: {
      storefront: { clientId, ...(opts.context !== undefined ? { context: opts.context } : {}) },
    },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    ...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),
    // No `fetch`: a session-bearing client must never be tagged. Next's fetch
    // cache does not key on Authorization.
  });
}

async function run<T>(
  fn: (client: EmporixClient, ctx: AuthContext, handle: EmporixSessionHandle) => Promise<T>,
  opts: WithEmporixSessionOptions,
  readOnly: boolean,
): Promise<T> {
  const handle = await emporixSessionHandle({
    readOnly,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
  const customerToken = handle.get(STORAGE_KEYS.customerToken);
  const client =
    customerToken !== null
      ? // Customer path: the memoized client is correct, the token is per call.
        getEmporixClient({ ...opts, tagged: false })
      : newGuestClient(opts);
  const ctx = customerToken !== null ? auth.customer(customerToken) : auth.anonymous();
  if (customerToken === null) {
    client.tokenProvider.attachAnonymousStore?.(anonymousStore(handle));
  }
  // Store mode needs one write at the end; in cookie mode `set` already wrote
  // through and flush is a no-op. The read-only variant never flushes.
  //
  // The flush also runs when `fn` THREW, and that is the point. By then the
  // handle can already hold a rotated anonymous refresh token — Emporix rotates
  // it on every refresh — or a cleanup the callback did before failing. Cookie
  // mode wrote those through the moment they were set; store mode used to drop
  // them, so a failed Server Action left the session pointing at a refresh
  // token Emporix had already invalidated, and the guest lost their cart on the
  // next request. A store failure while unwinding must not replace the error
  // the caller needs to see.
  try {
    const result = await fn(client, ctx, handle);
    if (!readOnly) await handle.flush();
    return result;
  } catch (e) {
    if (!readOnly) {
      await handle.flush().catch((cause: unknown) => {
        reportEmporixError({
          code: "session.flush_failed",
          degradedTo:
            "session may still point at a rotated anonymous token; the guest can lose their cart",
          cause,
        });
      });
    }
    throw e;
  }
}

/**
 * Runs `fn` with the request's Emporix session bound — **read-only**.
 *
 * Use this in Server Components. Cookie writes no-op, because Next forbids
 * writing a cookie during a render. Token rotation therefore belongs in the
 * proxy, which is the only place that can read cookies and write them before
 * the render happens.
 *
 * Branches on the session so the caller does not have to: a customer token in
 * the cookie means the memoized untagged client plus `auth.customer`, no token
 * means a per-request client with a per-guest anonymous session plus
 * `auth.anonymous`.
 *
 * Catalog reads should NOT go through here — they need no stable session, and a
 * read-only handle cannot persist the anonymous session the SDK just obtained, so
 * every render would log in again. Use `getEmporixClient()` for those.
 *
 * @example
 * ```ts
 * const cart = await withEmporixSession((client, ctx) => client.carts.get(id, ctx));
 * ```
 */
export async function withEmporixSession<T>(
  fn: (client: EmporixClient, ctx: AuthContext, handle: EmporixSessionHandle) => Promise<T>,
  opts: WithEmporixSessionOptions = {},
): Promise<T> {
  return run(fn, opts, true);
}

/**
 * Runs `fn` with the request's Emporix session bound — **read-write**.
 *
 * Valid in Server Actions and Route Handlers only. Persists a rotated anonymous
 * session, so a guest keeps the same Emporix `sessionId` and therefore the same
 * cart.
 *
 * The third argument is the session handle, and it matters in store mode: build
 * your own with `emporixSessionHandle()` and you get a SECOND handle for the same
 * request, which mints its own session id and needs its own flush. Take this one
 * and there is exactly one record, flushed once, here.
 *
 * @example
 * ```ts
 * "use server";
 * export async function addToCart(productId: string) {
 *   return withEmporixSessionMutable(async (client, ctx, handle) => {
 *     const cartId = handle.get(STORAGE_KEYS.cartId);
 *     …
 *     handle.set(STORAGE_KEYS.cartId, id, SESSION_MAX_AGE.cartId);
 *   });
 * }
 * ```
 */
export async function withEmporixSessionMutable<T>(
  fn: (client: EmporixClient, ctx: AuthContext, handle: EmporixSessionHandle) => Promise<T>,
  opts: WithEmporixSessionOptions = {},
): Promise<T> {
  return run(fn, opts, false);
}
