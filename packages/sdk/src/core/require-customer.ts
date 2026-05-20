import type { AuthContext } from "./auth";
import { EmporixAuthError } from "./errors";

/**
 * Enforces a caller-owned customer or raw token. Throws `EmporixAuthError`
 * for any other `AuthContext` kind (or when `auth` is missing). Shared by
 * services whose endpoints require a customer scope (`/me`, payments,
 * customer-segments…).
 */
export function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("This operation requires a customer or raw AuthContext");
}
