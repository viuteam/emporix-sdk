import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";

/** Options accepted by every read hook to override the per-call auth context. */
export interface QueryOpts {
  auth?: AuthContext;
}

/**
 * Picks the auth context for a read hook. If `override` is given, returns it.
 * Otherwise: customer if a token is in storage, anonymous as fallback.
 *
 * Callers compose `ctx.kind` into their query keys to separate cache entries
 * across auth boundaries — `ctx.kind` is the discriminator of AuthContext,
 * one of `"service" | "anonymous" | "customer" | "raw"`.
 */
export function useReadAuth(override?: AuthContext): { ctx: AuthContext } {
  const { storage } = useEmporix();
  if (override) return { ctx: override };
  const token = storage.getCustomerToken();
  return token ? { ctx: auth.customer(token) } : { ctx: auth.anonymous() };
}

/**
 * Returns a customer `AuthContext` from the stored token. Throws if no token
 * exists in storage — use for hooks that are intentionally customer-only
 * (profile updates, password change, address management, payment modes).
 */
export function useCustomerOnlyCtx(): AuthContext {
  const { storage } = useEmporix();
  const token = storage.getCustomerToken();
  if (!token) {
    throw new Error("Requires a logged-in customer (no token in storage)");
  }
  return auth.customer(token);
}
