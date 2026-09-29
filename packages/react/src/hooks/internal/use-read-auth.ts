import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";
import { useCustomerToken } from "./use-storage-snapshot";

/** Options accepted by every read hook to override the per-call auth context. */
export interface QueryOpts {
  auth?: AuthContext;
}

/**
 * Picks the auth context for a read hook. If `override` is given, returns it.
 * Otherwise: customer if a token is in storage, anonymous as fallback.
 * Token reads go through `useCustomerToken` (useSyncExternalStore) so the
 * context — and every query key carrying `ctx.kind` — updates reactively on
 * login/logout instead of waiting for an unrelated re-render.
 */
export function useReadAuth(override?: AuthContext): { ctx: AuthContext } {
  const token = useCustomerToken();
  if (override) return { ctx: override };
  return token ? { ctx: auth.customer(token) } : { ctx: auth.anonymous() };
}

/**
 * For customer-only mutations: returns a function that resolves the customer
 * context when the mutation runs, reading the token from storage at that
 * moment. Without a token the mutation fails with this error — the render
 * that set it up does not, so a component guests also see can hold the hook.
 * (Customer-only reads gate instead: `useEmporixQuery` with `mode: "customer"`.)
 */
export function useCustomerCtxResolver(): () => AuthContext {
  const { storage } = useEmporix();
  return () => {
    const token = storage.getCustomerToken();
    if (!token) throw new Error("Requires a logged-in customer (no token in storage)");
    return auth.customer(token);
  };
}
