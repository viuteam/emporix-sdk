import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { auth, type Customer } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

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
  });

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await client.customers.login(input);
      storage.setCustomerToken(session.customerToken);
      setToken(session.customerToken);
      setRefreshTok(session.refreshToken || null);
      setSaasTok(session.saasToken || null);
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
    [client, storage, qc],
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
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
    [storage, qc],
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
