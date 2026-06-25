import { createContext, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryStorage } from "./storage/memory";
import { EmporixTelemetryContext } from "./telemetry";
import { CompanyContextProvider } from "./company-context";
import { SiteContextProvider } from "./site-context";
import { useEmporixQueryDefaults } from "./hooks/internal/use-emporix-query-defaults";
import { useProviderWiring } from "./hooks/internal/use-provider-wiring";
import { useTelemetrySource } from "./hooks/internal/use-telemetry-source";
import { useCustomerTokenRefresher } from "./hooks/internal/use-customer-token-refresher";
import type { EmporixContextValue, EmporixProviderProps } from "./provider.types";

export type { EmporixProviderProps, SiteContextValue } from "./provider.types";
export { EmporixSiteContext } from "./site-context";

const EmporixContext = createContext<EmporixContextValue | null>(null);

/** Provides the SDK client, token storage, react-query client, and site context to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  initialSiteCode,
  initialLanguage,
  initialActiveLegalEntityId,
  onTelemetry,
  autoRefreshCustomerToken,
  onCustomerSessionExpired,
  children,
}: EmporixProviderProps): React.JSX.Element {
  const value = useMemo<EmporixContextValue>(() => {
    const s =
      storage ??
      createMemoryStorage(
        initialCustomerToken !== undefined ? { initial: initialCustomerToken } : {},
      );
    return { client, storage: s };
  }, [client, storage, initialCustomerToken]);

  // Fallback QueryClient held in state, not useMemo: React may discard a
  // useMemo cache, which would silently drop the entire query cache mid-session.
  // Defaults are applied via setQueryDefaults, scoped to ["emporix"].
  const [fallbackQc] = useState(() => new QueryClient());
  const qc = queryClient ?? fallbackQc;

  useEmporixQueryDefaults(qc);

  useProviderWiring({
    client,
    storage: value.storage,
    ...(initialCustomerToken !== undefined ? { initialCustomerToken } : {}),
    ...(storage !== undefined ? { externalStorage: storage } : {}),
  });

  const telemetryValue = useTelemetrySource({
    qc,
    client,
    storage: value.storage,
    ...(onTelemetry !== undefined ? { onTelemetry } : {}),
  });

  useCustomerTokenRefresher({
    client,
    storage: value.storage,
    emit: telemetryValue.emit,
    ...(autoRefreshCustomerToken !== undefined ? { enabled: autoRefreshCustomerToken } : {}),
    ...(onCustomerSessionExpired !== undefined ? { onExpired: onCustomerSessionExpired } : {}),
  });

  return (
    <EmporixContext.Provider value={value}>
      <EmporixTelemetryContext.Provider value={telemetryValue}>
        <QueryClientProvider client={qc}>
          <SiteContextProvider
            client={client}
            storage={value.storage}
            {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
            {...(initialLanguage !== undefined ? { initialLanguage } : {})}
          >
            <CompanyContextProvider
              client={client}
              storage={value.storage}
              {...(initialActiveLegalEntityId !== undefined
                ? { initialActiveLegalEntityId }
                : {})}
            >
              {children}
            </CompanyContextProvider>
          </SiteContextProvider>
        </QueryClientProvider>
      </EmporixTelemetryContext.Provider>
    </EmporixContext.Provider>
  );
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
