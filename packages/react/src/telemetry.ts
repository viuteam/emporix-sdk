import { createContext, useContext } from "react";

/**
 * All telemetry events emitted through the EmporixProvider's `onTelemetry`
 * callback. Discriminated by `type` — exhaustive switch is type-safe.
 *
 * Consumers can emit their own `{ type: "custom" }` events via
 * {@link useEmporixTelemetry}. Namespace `name` with an app-specific
 * prefix (e.g. `"app.checkout-cta-click"`) to avoid collisions with
 * future SDK event types.
 */
export type EmporixTelemetryEvent =
  // Cache lifecycle (React-Query QueryCache)
  | { type: "cache.hit"; queryKey: readonly unknown[]; tenant: string }
  | {
      type: "cache.miss";
      queryKey: readonly unknown[];
      tenant: string;
      durationMs: number;
    }
  | {
      type: "query.refetch";
      queryKey: readonly unknown[];
      tenant: string;
      reason: "invalidate" | "focus" | "stale";
    }
  | {
      type: "query.error";
      queryKey: readonly unknown[];
      tenant: string;
      error: unknown;
    }
  // Mutation lifecycle
  | {
      type: "mutation.success";
      mutationKey?: readonly unknown[];
      tenant: string;
      durationMs: number;
    }
  | {
      type: "mutation.error";
      mutationKey?: readonly unknown[];
      tenant: string;
      error: unknown;
      durationMs: number;
    }
  // Auth refresh (SDK-side)
  | {
      type: "auth.refresh";
      kind: "anonymous" | "customer";
      tenant: string;
      success: boolean;
    }
  // Storage writes
  | {
      type: "storage.write";
      key: "customerToken" | "cartId" | "siteCode" | "language" | "anonymousSession" | "activeLegalEntityId" | "refreshToken";
    }
  // Active-company switch (B2B)
  | {
      type: "company:switched";
      from: string | null;
      to: string | null;
      durationMs: number;
    }
  // Consumer-emitted
  | { type: "custom"; name: string; props?: Record<string, unknown> };

/** Internal: the React context carrying the emit function down the tree. */
export const EmporixTelemetryContext = createContext<{
  emit: (event: EmporixTelemetryEvent) => void;
} | null>(null);

/**
 * Hook to emit custom telemetry events through the same channel as SDK
 * events. Throws when used outside an {@link EmporixProvider}.
 *
 * When the provider has no `onTelemetry` callback configured, `emit` is a
 * no-op — calling it is safe and incurs no overhead.
 */
export function useEmporixTelemetry(): {
  emit: (event: EmporixTelemetryEvent) => void;
} {
  const ctx = useContext(EmporixTelemetryContext);
  if (!ctx) {
    throw new Error("useEmporixTelemetry must be used within an EmporixProvider");
  }
  return ctx;
}
