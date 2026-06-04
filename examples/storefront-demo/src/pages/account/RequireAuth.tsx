import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";

/** Gate for customer-only pages — bounces guests back to the sign-in screen. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useCustomerSession();
  if (!isAuthenticated) return <Navigate to="/account" replace />;
  return <>{children}</>;
}
