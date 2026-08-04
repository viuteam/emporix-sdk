import {
  EmporixClient,
  auth,
  type AnonymousSessionStore,
  type AuthContext,
} from "@viu/emporix-sdk";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { getEmporixClient } from "./client";
import { SESSION_MAX_AGE, emporixSessionHandle, type EmporixSessionHandle } from "./session-cookies";
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
  /** Bound at anonymous login. Must match what the rest of the app binds. */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
}

/** Persists the anonymous session in an httpOnly cookie, per guest. */
function anonymousStore(handle: EmporixSessionHandle): AnonymousSessionStore {
  return {
    read: () => {
      const raw = handle.get(STORAGE_KEYS.anonymousSession);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<{ refreshToken: string; sessionId: string }>;
        return typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string"
          ? { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId }
          : null;
      } catch {
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
        JSON.stringify({ refreshToken: session.refreshToken, sessionId: session.sessionId }),
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
  if (customerToken !== null) {
    // Customer path: the memoized client is correct, the token is per call.
    const client = getEmporixClient({ ...opts, tagged: false });
    const result = await fn(client, auth.customer(customerToken), handle);
    // Store mode needs one write at the end; in cookie mode `set` already wrote
    // through and this is a no-op. The read-only variant never flushes.
    if (!readOnly) await handle.flush();
    return result;
  }
  const client = newGuestClient(opts);
  client.tokenProvider.attachAnonymousStore?.(anonymousStore(handle));
  const result = await fn(client, auth.anonymous(), handle);
  if (!readOnly) await handle.flush();
  return result;
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
