import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";

/** Options accepted by every read hook to override the per-call auth context. */
export interface QueryOpts {
  auth?: AuthContext;
}

/**
 * Picks the auth context for a read hook. If `override` is given, returns it.
 * Otherwise: customer if a token is in storage, anonymous as fallback.
 * The `kind` string is included in query-keys so cache entries are
 * separated per auth boundary.
 */
export function useReadAuth(
  override?: AuthContext,
): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}
