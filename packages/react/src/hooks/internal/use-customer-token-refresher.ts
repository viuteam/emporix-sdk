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
}

/**
 * Opt-in reactive customer-token auto-refresh. Registered on the client so
 * the core HttpClient can refresh-and-retry a customer 401. Single-flight is
 * handled in the core registry. Off unless `enabled`.
 */
export function useCustomerTokenRefresher({
  client,
  storage,
  enabled,
  emit,
  onExpired,
}: CustomerTokenRefresherArgs): void {
  useEffect(() => {
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
  }, [enabled, client, storage, emit, onExpired]);
}
