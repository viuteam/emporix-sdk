import { useCallback, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { auth, type Customer, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../storage";
import { EmporixSiteContext, useEmporix, type SiteContextValue } from "../provider";
import { bootstrapCart } from "./internal/bootstrap-cart";

/** Customer authentication state and actions. */
export interface CustomerSessionApi {
  customerToken: string | null;
  customer: Customer | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Current refresh token (in-session; set by `login`). */
  refreshToken: string | null;
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
  const [token, setToken] = useState<string | null>(() => storage.getCustomerToken());
  // Refresh / saas tokens are kept in-session (not persisted by TokenStorage).
  const [refreshTok, setRefreshTok] = useState<string | null>(null);
  const [saasTok, setSaasTok] = useState<string | null>(null);

  useEffect(() => {
    return storage.subscribe?.((t) => setToken(t));
  }, [storage]);

  const meQuery = useQuery({
    queryKey: ["emporix", "customer", "me", { tenant: client.tenant, hasToken: token !== null }],
    enabled: token !== null,
    queryFn: () => client.customers.me(auth.customer(token as string)),
    // 30s — matches Balanced default. Lets honourPreferredSite's fetchQuery
    // (with staleTime: Infinity) reuse the cache instead of refetching.
    staleTime: 30_000,
  });

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await client.customers.login(input);
      storage.setCustomerToken(session.customerToken);
      setToken(session.customerToken);
      setRefreshTok(session.refreshToken || null);
      setSaasTok(session.saasToken || null);
      await onboardCustomerCart({
        qc,
        client,
        storage,
        customerToken: session.customerToken,
      });
      // Honour preferred site BEFORE invalidate — writes meQuery cache.
      await honourPreferredSite({
        qc,
        client,
        customerToken: session.customerToken,
        siteCtx,
      });
      // refetchType: "none" — mark stale but DO NOT trigger an immediate
      // refetch. The fresh /customer/me from honourPreferredSite already
      // updated the cache; remounts past 30s staleness will refetch.
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"], refetchType: "none" });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"], refetchType: "none" });
    },
    [client, storage, qc, siteCtx],
  );

  const signup = useCallback(
    async (input: { email: string; password: string }) => {
      await client.customers.signup(input);
    },
    [client],
  );

  // Shared "store a CustomerSession into hook state" used by SSO flows.
  const applySession = useCallback(
    async (session: { customerToken: string; refreshToken: string; saasToken: string }) => {
      storage.setCustomerToken(session.customerToken);
      setToken(session.customerToken);
      setRefreshTok(session.refreshToken || null);
      setSaasTok(session.saasToken || null);
      await onboardCustomerCart({
        qc,
        client,
        storage,
        customerToken: session.customerToken,
      });
      await honourPreferredSite({
        qc,
        client,
        customerToken: session.customerToken,
        siteCtx,
      });
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"], refetchType: "none" });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"], refetchType: "none" });
    },
    [client, storage, qc, siteCtx],
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
    if (token) {
      // Best-effort server invalidation; the local session is cleared
      // regardless (the token may already be expired/invalid).
      try {
        await client.customers.logout(auth.customer(token));
      } catch {
        /* ignore — proceed to clear locally */
      }
    }
    storage.setCustomerToken(null);
    setToken(null);
    setRefreshTok(null);
    setSaasTok(null);
    qc.removeQueries({ queryKey: ["emporix", "customer"] });
    qc.removeQueries({ queryKey: ["emporix", "cart"] });
  }, [client, token, storage, qc]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const refreshSession = useCallback(async () => {
    if (!refreshTok) return;
    const session = await client.customers.refresh({
      refreshToken: refreshTok,
      ...(saasTok ? { saasToken: saasTok } : {}),
    });
    storage.setCustomerToken(session.customerToken);
    setToken(session.customerToken);
    setRefreshTok(session.refreshToken || refreshTok);
    if (session.saasToken) setSaasTok(session.saasToken);
    await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  }, [client, storage, qc, refreshTok, saasTok]);

  return {
    customerToken: token,
    refreshToken: refreshTok,
    customer: meQuery.data ?? null,
    isAuthenticated: token !== null,
    isLoading: meQuery.isLoading && token !== null,
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
