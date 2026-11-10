import { createContext, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PROXY_CUSTOMER_TOKEN,
  createProxySessionStorage,
  type ProxySessionStorage,
} from "@viu/emporix-sdk";
import { createMemoryStorage } from "./storage/memory";
import { EmporixTelemetryContext } from "./telemetry";
import { CompanyContextProvider } from "./company-context";
import { SiteContextProvider } from "./site-context";
import { useEmporixQueryDefaults } from "./hooks/internal/use-emporix-query-defaults";
import {
  HostTokenContext,
  ProxySessionContext,
  useIsomorphicLayoutEffect,
  useProviderWiring,
} from "./hooks/internal/use-provider-wiring";
import { useTelemetrySource } from "./hooks/internal/use-telemetry-source";
import { useCustomerTokenRefresher } from "./hooks/internal/use-customer-token-refresher";
import type { EmporixContextValue, EmporixProviderProps } from "./provider.types";

export type {
  EmporixProviderProps,
  EmporixProxySession,
  SiteContextValue,
} from "./provider.types";
export { EmporixSiteContext } from "./site-context";

const EmporixContext = createContext<EmporixContextValue | null>(null);

/** Provides the SDK client, token storage, react-query client, and site context to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  customerSession,
  proxySession,
  initialSiteCode,
  initialLanguage,
  initialActiveLegalEntityId,
  onTelemetry,
  autoRefreshCustomerToken,
  onCustomerSessionExpired,
  children,
}: EmporixProviderProps): React.JSX.Element {
  // `?.` because test doubles often carry no config at all.
  const proxied = client.config?.proxy !== undefined;
  const session = customerSession ?? (proxied ? "proxy" : "owned");
  assertSessionMode(session, proxied, initialCustomerToken, autoRefreshCustomerToken);
  const authenticated = proxySession?.authenticated ?? false;

  // Fallback storage held in state, not useMemo, and NOT keyed on the token:
  // recreating storage to deliver a new token silently discards cartId,
  // siteCode, language and activeLegalEntityId. Seeding and rotation are
  // useProviderWiring's job. Same reasoning as `fallbackQc` below.
  const [fallbackStorage] = useState(() => createMemoryStorage());
  const baseStorage = storage ?? fallbackStorage;
  // Proxy mode puts a view in front of the storage that never holds a token. A
  // recreated view loses nothing — every slot it keeps passes through to
  // `baseStorage` — so a memo is enough. `authenticated` is left out on purpose:
  // it reaches the view below without replacing it.
  const effectiveStorage = useMemo(
    () => (session === "proxy" ? createProxySessionStorage(baseStorage, authenticated) : baseStorage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, baseStorage],
  );
  // Render-time readers take the new state from HostTokenContext in the same
  // render; this tells everyone subscribed to the storage, before paint.
  useIsomorphicLayoutEffect(() => {
    if (session === "proxy") {
      (effectiveStorage as ProxySessionStorage).setProxyAuthenticated(authenticated);
    }
  }, [session, effectiveStorage, authenticated]);
  const value = useMemo<EmporixContextValue>(
    () => ({ client, storage: effectiveStorage }),
    [client, effectiveStorage],
  );

  // Fallback QueryClient held in state, not useMemo: React may discard a
  // useMemo cache, which would silently drop the entire query cache mid-session.
  // Defaults are applied via setQueryDefaults, scoped to ["emporix"].
  const [fallbackQc] = useState(() => new QueryClient());
  const qc = queryClient ?? fallbackQc;

  useEmporixQueryDefaults(qc);

  useProviderWiring({
    client,
    storage: value.storage,
    customerSession: session,
    ...(initialCustomerToken !== undefined ? { initialCustomerToken } : {}),
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
    customerSession: session,
    emit: telemetryValue.emit,
    ...(autoRefreshCustomerToken !== undefined ? { enabled: autoRefreshCustomerToken } : {}),
    ...(onCustomerSessionExpired !== undefined ? { onExpired: onCustomerSessionExpired } : {}),
  });

  const hostToken =
    session === "external"
      ? initialCustomerToken
      : session === "proxy"
        ? authenticated
          ? PROXY_CUSTOMER_TOKEN
          : null
        : undefined;

  return (
    <EmporixContext.Provider value={value}>
      <HostTokenContext.Provider value={hostToken}>
        <ProxySessionContext.Provider value={session === "proxy" ? (proxySession ?? {}) : null}>
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
                  customerSession={session}
                  {...(initialActiveLegalEntityId !== undefined
                    ? { initialActiveLegalEntityId }
                    : {})}
                >
                  {children}
                </CompanyContextProvider>
              </SiteContextProvider>
            </QueryClientProvider>
          </EmporixTelemetryContext.Provider>
        </ProxySessionContext.Provider>
      </HostTokenContext.Provider>
    </EmporixContext.Provider>
  );
}

/**
 * Configuration mistakes that would otherwise surface as a token in the browser
 * or a login that cannot work, so they fail the first render instead.
 */
function assertSessionMode(
  session: "owned" | "external" | "proxy",
  proxied: boolean,
  initialCustomerToken: string | undefined,
  autoRefreshCustomerToken: boolean | undefined,
): void {
  if (session === "proxy" && !proxied) {
    throw new Error(
      'customerSession "proxy" needs a client built with `proxy`: without it the SDK requests ' +
        "tokens itself. See docs/bff.md.",
    );
  }
  if (session !== "proxy" && proxied) {
    throw new Error(
      `customerSession "${session}" cannot be used with a proxy-mode client: the proxy owns the ` +
        'session. Use customerSession "proxy" (the default for such a client).',
    );
  }
  if (session === "proxy" && initialCustomerToken !== undefined) {
    throw new Error('initialCustomerToken cannot be used with customerSession "proxy": the browser holds no token');
  }
  if (session === "proxy" && autoRefreshCustomerToken) {
    throw new Error('autoRefreshCustomerToken cannot be used with customerSession "proxy": the proxy refreshes');
  }
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
