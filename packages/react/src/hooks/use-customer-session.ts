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
  logout: () => void;
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

  const logout = useCallback(() => {
    storage.setCustomerToken(null);
    setToken(null);
    setRefreshTok(null);
    setSaasTok(null);
    qc.removeQueries({ queryKey: ["emporix", "customer"] });
    qc.removeQueries({ queryKey: ["emporix", "cart"] });
  }, [storage, qc]);

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
    logout,
    refresh,
    refreshSession,
  };
}
