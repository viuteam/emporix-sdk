import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { auth, type Customer, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../storage";
import { EmporixSiteContext, useEmporix, type SiteContextValue } from "../provider";
import { bootstrapCart } from "./internal/bootstrap-cart";
import {
  getCustomerSessionStore,
  type CustomerSessionState,
} from "./internal/customer-session-store";

/**
 * Internal: the three session tokens the hook tracks. Bundled so login/
 * applySession/logout/refresh all flip the session atomically — partial
 * updates use the setter-callback form (e.g. external storage notifications
 * that only change `token`). State lives in a per-storage shared store so
 * every consumer (auth form, checkout, header) observes the same session.
 */
type SessionState = CustomerSessionState;

const EMPTY_SESSION: SessionState = {
  token: null,
  refreshToken: null,
  saasToken: null,
};

/** Customer authentication state and actions. */
export interface CustomerSessionApi {
  customerToken: string | null;
  customer: Customer | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Current refresh token (in-session; set by `login`). */
  refreshToken: string | null;
  /**
   * Current SaaS token (in-session; set by `login`/`exchangeToken`). Pass it to
   * `useCheckout().placeOrder({ ..., saasToken })` for customer checkout and to
   * saas-token-gated order reads.
   */
  saasToken: string | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  signup: (input: { email: string; password: string }) => Promise<void>;
  /** Authorization-Code SSO: exchanges an IdP `code` for a customer session. */
  socialLogin: (input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    sessionId?: string;
  }) => Promise<void>;
  /** RFC 8693 token exchange: exchanges an external IdP JWT for a session. */
  exchangeToken: (input: { subjectToken: string; config?: string }) => Promise<void>;
  /** Server-side logout (best-effort), then clears the local session. */
  logout: () => Promise<void>;
  /** Refetches the `me` profile query. */
  refresh: () => Promise<void>;
  /**
   * Exchanges the stored refresh token for a fresh customer token (same
   * sessionId) and updates the stored token. No-op if there is no refresh
   * token. Throws if the refresh itself fails.
   */
  refreshSession: () => Promise<void>;
}

/** Manages the customer session: login/signup/logout and the `me` query. */
export function useCustomerSession(): CustomerSessionApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  // Optional — present when wrapped in an EmporixProvider (always true post-MS-2).
  const siteCtx = useContext(EmporixSiteContext);
  // Single session-state object held in a per-storage shared store so all
  // consumers see the same in-memory `refreshToken`/`saasToken`. `token` is
  // mirrored from storage; `refreshToken`/`saasToken` are in-session only.
  const store = useMemo(() => getCustomerSessionStore(storage), [storage]);
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const setSession = store.setState;

  useEffect(() => {
    // External token change (e.g. another tab) updates only the `token` slot.
    return storage.subscribe?.((t) => setSession((s) => ({ ...s, token: t })));
  }, [storage, setSession]);

  const meQuery = useQuery({
    queryKey: ["emporix", "customer", "me", { tenant: client.tenant, hasToken: session.token !== null }],
    enabled: session.token !== null,
    queryFn: () => client.customers.me(auth.customer(session.token as string)),
    // 30s — matches Balanced default. Lets honourPreferredSite's fetchQuery
    // (with staleTime: Infinity) reuse the cache instead of refetching.
    staleTime: 30_000,
  });

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const result = await client.customers.login(input);
      storage.setCustomerToken(result.customerToken);
      storage.setRefreshToken(result.refreshToken || null);
      // The guest (anonymous) session is dead weight once a customer token is
      // set — the auth layer always prefers the customer token, so the stored
      // anonymous session would just linger unused. Drop it on login.
      storage.setAnonymousSession(null);
      setSession({
        token: result.customerToken,
        refreshToken: result.refreshToken || null,
        saasToken: result.saasToken || null,
      });
      await onboardCustomerCart({
        qc,
        client,
        storage,
        customerToken: result.customerToken,
      });
      // Honour preferred site BEFORE invalidate — writes meQuery cache.
      await honourPreferredSite({
        qc,
        client,
        customerToken: result.customerToken,
        siteCtx,
      });
      // refetchType: "none" — mark stale but DO NOT trigger an immediate
      // refetch. The fresh /customer/me from honourPreferredSite already
      // updated the cache; remounts past 30s staleness will refetch.
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"], refetchType: "none" });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"], refetchType: "none" });
    },
    [client, storage, qc, siteCtx, setSession],
  );

  const signup = useCallback(
    async (input: { email: string; password: string }) => {
      await client.customers.signup(input);
    },
    [client],
  );

  // Shared "store a CustomerSession into hook state" used by SSO flows.
  const applySession = useCallback(
    async (incoming: { customerToken: string; refreshToken: string; saasToken: string }) => {
      storage.setCustomerToken(incoming.customerToken);
      storage.setRefreshToken(incoming.refreshToken || null);
      // Drop the now-dormant guest session (see login()).
      storage.setAnonymousSession(null);
      setSession({
        token: incoming.customerToken,
        refreshToken: incoming.refreshToken || null,
        saasToken: incoming.saasToken || null,
      });
      await onboardCustomerCart({
        qc,
        client,
        storage,
        customerToken: incoming.customerToken,
      });
      await honourPreferredSite({
        qc,
        client,
        customerToken: incoming.customerToken,
        siteCtx,
      });
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"], refetchType: "none" });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"], refetchType: "none" });
    },
    [client, storage, qc, siteCtx, setSession],
  );

  const socialLogin = useCallback(
    async (input: {
      code: string;
      redirectUri: string;
      codeVerifier?: string;
      sessionId?: string;
    }) => {
      await applySession(await client.customers.socialLogin(input));
    },
    [client, applySession],
  );

  const exchangeToken = useCallback(
    async (input: { subjectToken: string; config?: string }) => {
      await applySession(await client.customers.exchangeToken(input));
    },
    [client, applySession],
  );

  const logout = useCallback(async () => {
    if (session.token) {
      // Best-effort server invalidation; the local session is cleared
      // regardless (the token may already be expired/invalid).
      try {
        await client.customers.logout(auth.customer(session.token));
      } catch {
        /* ignore — proceed to clear locally */
      }
    }
    storage.setCustomerToken(null);
    storage.setRefreshToken(null);
    storage.setActiveLegalEntityId(null);
    // Drop the cart reference: the cart belonged to the customer and is not
    // accessible anonymously, so keeping it would make the cart query 403
    // right after logout. A fresh anonymous cart bootstraps on demand.
    storage.setCartId(null);
    setSession(EMPTY_SESSION);
    // Purge EVERYTHING under the emporix namespace: customer-scoped caches
    // (payment-modes, orders, …) are keyed by authKind without a user id, so
    // a later login as a different customer would be served the previous
    // customer's data straight from cache. bootstrap-cart.ts already
    // documents this contract.
    qc.removeQueries({ queryKey: ["emporix"] });
  }, [client, session.token, storage, qc, setSession]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const refreshSession = useCallback(async () => {
    if (!session.refreshToken) return;
    const refreshed = await client.customers.refresh({
      refreshToken: session.refreshToken,
      ...(session.saasToken ? { saasToken: session.saasToken } : {}),
    });
    storage.setCustomerToken(refreshed.customerToken);
    if (refreshed.refreshToken) storage.setRefreshToken(refreshed.refreshToken);
    setSession((s) => ({
      token: refreshed.customerToken,
      refreshToken: refreshed.refreshToken || s.refreshToken,
      saasToken: refreshed.saasToken || s.saasToken,
    }));
    await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  }, [client, storage, qc, session.refreshToken, session.saasToken, setSession]);

  return {
    customerToken: session.token,
    refreshToken: session.refreshToken,
    saasToken: session.saasToken,
    customer: meQuery.data ?? null,
    isAuthenticated: session.token !== null,
    isLoading: meQuery.isLoading && session.token !== null,
    login,
    signup,
    socialLogin,
    exchangeToken,
    logout,
    refresh,
    refreshSession,
  };
}

/**
 * Best-effort customer cart onboarding right after a fresh customer token is
 * stored. Loads (or creates) the open customer cart for the configured
 * `siteCode`, merges any guest `cartId` from storage into it, and writes the
 * customer-cart-id back to `storage.setCartId(...)`. Never throws — failures
 * are swallowed so login does not block on cart trouble.
 */
/**
 * After login, switch the active site to the customer's `preferredSite` if
 * one is set and differs from the current siteCode. Uses `qc.fetchQuery` with
 * the same key as `meQuery` so the post-login `/customer/me` call is shared
 * (no double-fetch). Best-effort: failure never blocks login.
 */
async function honourPreferredSite(opts: {
  qc: QueryClient;
  client: EmporixClient;
  customerToken: string;
  siteCtx: SiteContextValue | null;
}): Promise<void> {
  const { qc, client, customerToken, siteCtx } = opts;
  if (!siteCtx) return;
  try {
    const me = (await qc.fetchQuery({
      queryKey: [
        "emporix",
        "customer",
        "me",
        { tenant: client.tenant, hasToken: true },
      ],
      queryFn: () => client.customers.me(auth.customer(customerToken)),
      // Reuse whatever meQuery already wrote (login flow runs meQuery in
      // parallel). Without this, fetchQuery refetches if meQuery's data is
      // already stale (default staleTime: 0 on meQuery).
      staleTime: Infinity,
    })) as { preferredSite?: string };
    const preferred = me.preferredSite;
    if (preferred && siteCtx.siteCode !== preferred) {
      await siteCtx.setSite(preferred);
    }
  } catch {
    // Best-effort — never block login on a preference lookup.
  }
}

async function onboardCustomerCart(opts: {
  qc: QueryClient;
  client: EmporixClient;
  storage: EmporixStorage;
  customerToken: string;
}): Promise<void> {
  const { qc, client, storage, customerToken } = opts;
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (!siteCode) return; // No site context configured → skip.
  const ctx = auth.customer(customerToken);
  try {
    const customerCart = await bootstrapCart({
      qc,
      client,
      ctx,
      siteCode,
    });
    // Cart uses `id`; only `CartCreated` exposes `cartId`. See generated types.
    const customerCartId = customerCart?.id;
    if (!customerCartId) return;
    const anonCartId = storage.getCartId();
    if (anonCartId && anonCartId !== customerCartId) {
      await client.carts.merge(customerCartId, [anonCartId], ctx);
    }
    storage.setCartId(customerCartId);
  } catch {
    // Cart onboarding is best-effort; never fail login on cart trouble.
  }
}
