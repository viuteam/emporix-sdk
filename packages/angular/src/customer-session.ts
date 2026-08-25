import { computed, inject, signal, type Signal } from "@angular/core";
import { injectQueryClient, type QueryClient } from "@tanstack/angular-query-experimental";
import {
  auth,
  emporixKey,
  getCustomerSessionStore,
  type AuthContext,
  type Customer,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "./tokens";
import { injectEmporixQuery } from "./inject-query";
import { injectEmporixSite } from "./site";
import { injectEmporixSiteSwitch } from "./site-switch";

/** Customer authentication state and actions. */
export interface EmporixCustomerSession {
  token: Signal<string | null>;
  /** In-session only; set by `login`. Never persisted beyond the storage adapter. */
  refreshToken: Signal<string | null>;
  /**
   * In-session SaaS token. Pass it to customer checkout and to saas-token-gated
   * order reads.
   */
  saasToken: Signal<string | null>;
  customer: Signal<Customer | null>;
  isAuthenticated: Signal<boolean>;
  isLoading: Signal<boolean>;
  /** In flight for login / logout / signup / refreshSession. */
  isPending: Signal<boolean>;
  /** The last action's failure, cleared when the next one starts. */
  error: Signal<Error | null>;
  login(input: { email: string; password: string }): Promise<void>;
  signup(input: { email: string; password: string }): Promise<void>;
  /** Best-effort server logout, then clears the local session unconditionally. */
  logout(): Promise<void>;
  /**
   * Exchanges the stored refresh token for a fresh customer token. No-op without
   * one. Throws if the refresh itself fails.
   */
  refreshSession(): Promise<void>;
}

/**
 * The customer session: login, signup, logout, refresh, and the `me` profile.
 *
 * Deliberately absent, matching `@viu/emporix-sdk-next`'s reasoning: `socialLogin`
 * and `exchangeToken`. Both need an IdP configured at the tenant, and shipping an
 * SSO surface nobody can exercise means shipping something untested.
 */
export function injectCustomerSession(): EmporixCustomerSession {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();
  const site = injectEmporixSite();
  const switcher = injectEmporixSiteSwitch();

  // One store per storage instance, so a login in a header component is visible
  // to a checkout page. `token` mirrors storage; refresh and saas tokens are
  // in-session. The store's own storage subscription mirrors external writes.
  const store = getCustomerSessionStore(storage);
  const session = signal(store.getSnapshot());
  store.subscribe(() => session.set(store.getSnapshot()));

  const isPending = signal(false);
  const error = signal<Error | null>(null);

  const meQuery = injectEmporixQuery(() => ({
    resource: "customer-me",
    args: [] as const,
    site: "none" as const,
    mode: "customer" as const,
    queryFn: (ctx) => client.customers.me(ctx),
    staleTime: 30_000,
  }));

  /** Bracket an action: clear the last error, flag in-flight, always unflag. */
  const run = async (work: () => Promise<void>): Promise<void> => {
    error.set(null);
    isPending.set(true);
    try {
      await work();
    } catch (e) {
      error.set(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      isPending.set(false);
    }
  };

  const applySession = async (incoming: {
    customerToken: string;
    refreshToken?: string;
    saasToken?: string;
  }): Promise<void> => {
    storage.setCustomerToken(incoming.customerToken);
    storage.setRefreshToken(incoming.refreshToken || null);
    // Persisted so customer checkout survives a page reload: the refresh
    // endpoint cannot re-mint a saas token.
    storage.setSaasToken?.(incoming.saasToken || null);
    // The guest session is dead weight once a customer token is set — the auth
    // layer always prefers the customer token, so it would linger unused.
    storage.setAnonymousSession(null);
    store.setState({
      token: incoming.customerToken,
      refreshToken: incoming.refreshToken || null,
      saasToken: incoming.saasToken || null,
    });
    await onboardCustomerCart(qc, client, storage, incoming.customerToken);
    await honourPreferredSite(qc, client, incoming.customerToken, site.siteCode(), switcher);
    // refetchType "none": mark stale without an immediate refetch. Emporix bills
    // per call and honourPreferredSite already fetched a fresh profile.
    await qc.invalidateQueries({ queryKey: ["emporix", "customer-me"], refetchType: "none" });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"], refetchType: "none" });
  };

  return {
    token: computed(() => session().token),
    refreshToken: computed(() => session().refreshToken),
    saasToken: computed(() => session().saasToken),
    customer: computed(() => meQuery.data() ?? null),
    isAuthenticated: computed(() => session().token !== null),
    isLoading: computed(() => meQuery.isLoading() && session().token !== null),
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),

    login: (input) =>
      run(async () => {
        await applySession(await client.customers.login(input));
      }),

    signup: (input) =>
      run(async () => {
        await client.customers.signup(input);
      }),

    logout: () =>
      run(async () => {
        const token = session().token;
        if (token !== null) {
          try {
            await client.customers.logout(auth.customer(token));
          } catch {
            // Best-effort: the token may already be expired or revoked, and the
            // local session is cleared either way.
          }
        }
        storage.setCustomerToken(null);
        storage.setRefreshToken(null);
        storage.setSaasToken?.(null);
        storage.setActiveLegalEntityId(null);
        // The cart belonged to the customer and is not readable anonymously, so
        // keeping the id would make the next cart read 403. A fresh anonymous
        // cart bootstraps on demand.
        storage.setCartId(null);
        store.setState({ token: null, refreshToken: null, saasToken: null });
        // removeQueries, not invalidateQueries: customer-scoped entries are keyed
        // by authKind with no user id, so a later login as a DIFFERENT customer
        // would be served the previous customer's data straight from cache.
        qc.removeQueries({ queryKey: ["emporix"] });
      }),

    refreshSession: () =>
      run(async () => {
        const current = session();
        if (current.refreshToken === null) return;
        const refreshed = await client.customers.refresh({
          refreshToken: current.refreshToken,
          ...(current.saasToken !== null ? { saasToken: current.saasToken } : {}),
        });
        storage.setCustomerToken(refreshed.customerToken);
        if (refreshed.refreshToken) storage.setRefreshToken(refreshed.refreshToken);
        if (refreshed.saasToken) storage.setSaasToken?.(refreshed.saasToken);
        store.setState((s) => ({
          token: refreshed.customerToken,
          refreshToken: refreshed.refreshToken || s.refreshToken,
          saasToken: refreshed.saasToken || s.saasToken,
        }));
        await qc.invalidateQueries({ queryKey: ["emporix", "customer-me"] });
        await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
      }),
  };
}

/**
 * Load or create the customer's open cart and merge any guest cart into it.
 *
 * Never throws: login must not fail on cart trouble. But losing this step
 * silently is exactly the failure `@viu/emporix-sdk-next`'s error-reporting seam
 * was built to make visible — a guest fills a basket, logs in, and the basket is
 * gone with no trace.
 *
 * `fetchQuery` rather than a bare call so a concurrent cart read shares the one
 * server call. The key omits the cart id deliberately: this is the operation that
 * creates it.
 */
async function onboardCustomerCart(
  qc: QueryClient,
  client: EmporixClient,
  storage: EmporixStorage,
  customerToken: string,
): Promise<void> {
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (siteCode === undefined) return; // No site context configured → skip.
  const ctx = auth.customer(customerToken);
  try {
    const cart = await qc.fetchQuery({
      queryKey: [
        "emporix",
        "cart-bootstrap",
        { tenant: client.tenant, authKind: ctx.kind, siteCode },
      ],
      queryFn: () => client.carts.getCurrent(ctx, { siteCode, create: true }),
      staleTime: Infinity,
    });
    // Cart exposes `id`; only CartCreated exposes `cartId`. Not interchangeable.
    const customerCartId = cart?.id;
    if (customerCartId === undefined) return;
    const anonCartId = storage.getCartId();
    if (anonCartId !== null && anonCartId !== customerCartId) {
      // Path id is the CUSTOMER cart (the target); the body lists anonymous
      // carts to merge in. Easy to invert.
      await client.carts.merge(customerCartId, [anonCartId], ctx);
    }
    storage.setCartId(customerCartId);
  } catch {
    // Best-effort; never fail login on cart trouble.
  }
}

/**
 * Switch to the customer's `preferredSite` if it differs from the active one.
 *
 * Shares `injectCustomerSession`'s profile cache key so the post-login
 * `/customer/me` is a single billed call rather than two. Best-effort: a
 * preference lookup must never block a login.
 */
async function honourPreferredSite(
  qc: QueryClient,
  client: EmporixClient,
  customerToken: string,
  activeSiteCode: string | null,
  switcher: { setSite(code: string | null): Promise<void> },
): Promise<void> {
  try {
    const me = (await qc.fetchQuery({
      queryKey: emporixKey("customer-me", [], {
        tenant: client.tenant,
        authKind: "customer",
      }),
      queryFn: () => client.customers.me(auth.customer(customerToken)),
      // Reuse whatever the me query already wrote; without this it refetches.
      staleTime: Infinity,
    })) as { preferredSite?: string };
    if (me.preferredSite !== undefined && me.preferredSite !== activeSiteCode) {
      await switcher.setSite(me.preferredSite);
    }
  } catch {
    // Best-effort — never block login on a preference lookup.
  }
}

/** Re-exported for callers that want to build their own auth context. */
export type { AuthContext };
