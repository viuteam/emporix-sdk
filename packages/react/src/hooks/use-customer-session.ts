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
  login: (input: { email: string; password: string }) => Promise<void>;
  signup: (input: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

/** Manages the customer session: login/signup/logout and the `me` query. */
export function useCustomerSession(): CustomerSessionApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => storage.getCustomerToken());

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
    qc.removeQueries({ queryKey: ["emporix", "customer"] });
    qc.removeQueries({ queryKey: ["emporix", "cart"] });
  }, [storage, qc]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  return {
    customerToken: token,
    customer: meQuery.data ?? null,
    isAuthenticated: token !== null,
    isLoading: meQuery.isLoading && token !== null,
    login,
    signup,
    logout,
    refresh,
  };
}
