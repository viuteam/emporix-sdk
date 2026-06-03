import type { ReactNode } from "react";
import { EmporixErrorBoundary } from "@viu/emporix-sdk-react";
import { EmptyState } from "../components/ui/EmptyState";

export function RouteError({ children }: { children: ReactNode }) {
  return (
    <EmporixErrorBoundary
      fallback={
        <div className="container">
          <EmptyState title="Something went wrong">
            An error occurred talking to the tenant. Retry, or change the tenant from the footer.
          </EmptyState>
        </div>
      }
    >
      {children}
    </EmporixErrorBoundary>
  );
}
