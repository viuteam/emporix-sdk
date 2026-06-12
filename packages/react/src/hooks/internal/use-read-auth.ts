import { auth, type AuthContext } from "@viu/emporix-sdk";
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
 * Returns a customer `AuthContext` from the stored token. Throws if no token
 * exists in storage — use for hooks that are intentionally customer-only
 * (profile updates, password change, address management, payment modes).
 */
export function useCustomerOnlyCtx(): AuthContext {
  const token = useCustomerToken();
  if (!token) {
    throw new Error("Requires a logged-in customer (no token in storage)");
  }
  return auth.customer(token);
}
