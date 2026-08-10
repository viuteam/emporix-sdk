import { useEffect } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../../storage/index";
import type { EmporixTelemetryEvent } from "../../telemetry";

interface CustomerTokenRefresherArgs {
  client: EmporixClient;
  storage: EmporixStorage;
  /** Mirrors `autoRefreshCustomerToken`. When false the refresher is not registered. */
  enabled?: boolean;
  emit: (event: EmporixTelemetryEvent) => void;
  /** Called when no refresh token is stored or the refresh fails. */
  onExpired?: () => void;
  /** See `EmporixProviderProps.customerSession`. Always resolved by the provider. */
  customerSession: "owned" | "external";
}

/**
 * Opt-in reactive customer-token auto-refresh. Registered on the client so
 * the core HttpClient can refresh-and-retry a customer 401. Single-flight is
 * handled in the core registry. Off unless `enabled`.
 *
 * In `customerSession: "external"` mode it registers a **report-only** refresher
 * instead: the host owns the token, so a 401 is reported and never repaired.
 */
export function useCustomerTokenRefresher({
  client,
  storage,
  enabled,
  emit,
  onExpired,
  customerSession,
}: CustomerTokenRefresherArgs): void {
  // A dev-only guard: the two props state opposite intentions, and silently
  // picking one would hide the mistake.
  if (
    process.env.NODE_ENV !== "production" &&
    customerSession === "external" &&
    enabled === true
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[emporix] autoRefreshCustomerToken is ignored when customerSession is "external": ' +
        "a host-owned token is never refreshed by the SDK. Remove one of the two props.",
    );
  }

  useEffect(() => {
    if (customerSession === "external") {
      // Report-only. Registering rather than skipping is what makes the callback
      // fire at all: the HTTP layer consults the refresher on a customer 401 and
      // `registry.enabled` is `refresher !== null`. Returning null lets the 401
      // propagate as EmporixAuthError.
      //
      // Deliberately does NOT read storage.getRefreshToken(): reaching the same
      // end state by enabling autoRefreshCustomerToken and relying on an absent
      // refresh token would be an accident of the implementation, not a contract.
      client.setCustomerTokenRefresher({
        refresh: async () => {
          emit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onExpired?.();
          return null;
        },
      });
      return () => client.setCustomerTokenRefresher(null);
    }
    if (!enabled) return;
    client.setCustomerTokenRefresher({
      refresh: async () => {
        const refreshToken = storage.getRefreshToken();
        if (!refreshToken) {
          emit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onExpired?.();
          return null;
        }
        try {
          const legalEntityId = storage.getActiveLegalEntityId() ?? undefined;
          const s = await client.customers.refresh({
            refreshToken,
            ...(legalEntityId ? { legalEntityId } : {}),
          });
          storage.setCustomerToken(s.customerToken);
          if (s.refreshToken) storage.setRefreshToken(s.refreshToken);
          emit({ type: "auth.refresh", kind: "customer", success: true, tenant: client.tenant });
          return s.customerToken;
        } catch {
          emit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onExpired?.();
          return null;
        }
      },
    });
    return () => client.setCustomerTokenRefresher(null);
  }, [enabled, client, storage, emit, onExpired, customerSession]);
}
