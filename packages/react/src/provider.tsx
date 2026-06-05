import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";
import { EmporixTelemetryContext, type EmporixTelemetryEvent } from "./telemetry";
import { CompanyContextProvider } from "./company-context";

interface EmporixContextValue {
  client: EmporixClient;
  storage: EmporixStorage;
}

export interface SiteContextValue {
  siteCode: string | null;
  /** MS-4 populates this from the active site's DTO. */
  currency: string | null;
  /** MS-4 populates this from the active site's DTO. */
  targetLocation: string | null;
  /**
   * Asynchronous site switch. Updates local state + storage immediately
   * (optimistic), then PATCHes `/session-context/{tenant}/me/context` so
   * the server sees the same site on the next request. When no session
   * context exists yet (first visit, before any cart), the PATCH is
   * skipped — local state still flips.
   *
   * `isSwitching` is `true` while the PATCH is in flight. `switchError`
   * surfaces a PATCH failure; the optimistic state is NOT rolled back
   * (the cache was already invalidated, the UI already moved on).
   */
  setSite: (code: string | null) => Promise<void>;
  /**
   * Switch the active currency at runtime. Re-binds the anonymous price context
   * (so guest pricing changes even before a cart exists), clears the
   * currency-bound guest cart, and PATCHes an existing server session context.
   * The chosen currency must be in the active site's `availableCurrencies`.
   */
  setCurrency: (currency: string) => Promise<void>;
  isSwitching: boolean;
  switchError: Error | null;
}

const EmporixContext = createContext<EmporixContextValue | null>(null);
export const EmporixSiteContext = createContext<SiteContextValue | null>(null);

/**
 * Balanced React-Query defaults applied to the provider's fallback QueryClient
 * (only when no `queryClient` prop is passed). Keeps the Emporix API-quota in
 * check by suppressing window-focus refetches and capping retries.
 */
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

/** Props for {@link EmporixProvider}. */
export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: EmporixStorage;
  initialCustomerToken?: string;
  /**
   * Initial site code. Resolution order: this prop → `storage.getSiteCode()` →
   * `client.config.credentials.storefront.context.siteCode` → `null`.
   */
  initialSiteCode?: string;
  /**
   * Initial active legal-entity id (B2B). When set, the CompanyContext
   * provider tries to match it against `companies.listMine()` once the
   * customer is loaded; mismatches are dropped silently.
   */
  initialActiveLegalEntityId?: string | null;
  /**
   * Opt-in telemetry callback. Receives a typed event stream covering cache
   * hit/miss, refetches, errors, mutations, auth refreshes, storage writes,
   * and consumer-emitted custom events. Wire this to Datadog/Sentry/custom
   * analytics. The handler is wrapped in try/catch — a throwing handler
   * never breaks the provider.
   */
  onTelemetry?: (event: EmporixTelemetryEvent) => void;
  /**
   * Opt in to reactive customer-token auto-refresh: on a `customer`-kind 401,
   * the SDK refreshes once (via the stored refresh token + anonymous auth) and
   * retries. Default: false (the customer token stays caller-owned).
   */
  autoRefreshCustomerToken?: boolean;
  /**
   * Called when a customer-token refresh is needed but fails (refresh token
   * expired/revoked) or no refresh token is stored. Use to drive logout /
   * redirect to login.
   */
  onCustomerSessionExpired?: () => void;
  children: ReactNode;
}

/** Provides the SDK client, token storage, react-query client, and site context to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  initialSiteCode,
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
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    return { client, storage: s };
     
  }, [client, storage, initialCustomerToken]);
  const qc = useMemo(
    () =>
      queryClient ??
      new QueryClient({ defaultOptions: { queries: DEFAULT_QUERY_OPTIONS } }),
    [queryClient],
  );

  // Idempotent one-time wiring: attaches a storage-backed adapter to the SDK's
  // token provider so anonymous sessions survive reloads. Runs once per
  // (client, storage) pair via useState's lazy initializer.
  useState(() => {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => value.storage.getAnonymousSession(),
      write: (s) => value.storage.setAnonymousSession(s),
    });
    return null;
  });

  // Telemetry: stable safeEmit + context value. emit is no-op when no
  // onTelemetry callback was provided (no overhead).
  const safeEmit = useCallback(
    (event: EmporixTelemetryEvent) => {
      if (!onTelemetry) return;
      try {
        onTelemetry(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[emporix] telemetry handler threw:", err);
      }
    },
    [onTelemetry],
  );
  const telemetryValue = useMemo(() => ({ emit: safeEmit }), [safeEmit]);

  // Source subscriptions: cache + mutation cache + token-provider + storage.
  // All only active when onTelemetry is provided.
  useEffect(() => {
    if (!onTelemetry) return;
    const startedAt = new Map<string, number>();

    const unsubQuery = qc.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "emporix") return;
      if (event.type === "updated") {
        const action = event.action as { type: string };
        if (action.type === "fetch") {
          const isRefetch = event.query.state.dataUpdateCount > 0;
          if (isRefetch) {
            safeEmit({
              type: "query.refetch",
              queryKey: key,
              tenant: client.tenant,
              reason: "invalidate",
            });
          }
          startedAt.set(event.query.queryHash, Date.now());
        } else if (action.type === "success") {
          const start = startedAt.get(event.query.queryHash);
          startedAt.delete(event.query.queryHash);
          safeEmit({
            type: "cache.miss",
            queryKey: key,
            tenant: client.tenant,
            durationMs: start ? Date.now() - start : 0,
          });
        } else if (action.type === "error") {
          startedAt.delete(event.query.queryHash);
          safeEmit({
            type: "query.error",
            queryKey: key,
            tenant: client.tenant,
            error: event.query.state.error,
          });
        }
      } else if (event.type === "observerResultsUpdated") {
        const s = event.query.state;
        if (s.status === "success" && s.fetchStatus === "idle" && s.dataUpdateCount > 0) {
          safeEmit({ type: "cache.hit", queryKey: key, tenant: client.tenant });
        }
      }
    });

    const unsubMut = qc.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const m = event.mutation;
      const dur = Date.now() - (m.state.submittedAt ?? Date.now());
      const mk = m.options.mutationKey;
      if (m.state.status === "success") {
        safeEmit({
          type: "mutation.success",
          ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
          tenant: client.tenant,
          durationMs: dur,
        });
      } else if (m.state.status === "error") {
        safeEmit({
          type: "mutation.error",
          ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
          tenant: client.tenant,
          error: m.state.error,
          durationMs: dur,
        });
      }
    });

    const unsubAuth = client.tokenProvider.onRefresh?.((evt) =>
      safeEmit({ type: "auth.refresh", ...evt, tenant: client.tenant }),
    );

    const unsubStorage = value.storage.subscribeAll?.((key) =>
      safeEmit({ type: "storage.write", key }),
    );

    return () => {
      unsubQuery();
      unsubMut();
      unsubAuth?.();
      unsubStorage?.();
    };
  }, [qc, onTelemetry, client, value.storage, safeEmit]);

  // Opt-in reactive customer-token auto-refresh. Registered on the client so
  // the core HttpClient can refresh-and-retry a customer 401. Single-flight is
  // handled in the core registry. Off unless `autoRefreshCustomerToken`.
  useEffect(() => {
    if (!autoRefreshCustomerToken) return;
    const storage = value.storage;
    client.setCustomerTokenRefresher({
      refresh: async () => {
        const refreshToken = storage.getRefreshToken();
        if (!refreshToken) {
          safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onCustomerSessionExpired?.();
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
          safeEmit({ type: "auth.refresh", kind: "customer", success: true, tenant: client.tenant });
          return s.customerToken;
        } catch {
          safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onCustomerSessionExpired?.();
          return null;
        }
      },
    });
    return () => client.setCustomerTokenRefresher(null);
  }, [autoRefreshCustomerToken, client, value.storage, safeEmit, onCustomerSessionExpired]);

  return (
    <EmporixContext.Provider value={value}>
      <EmporixTelemetryContext.Provider value={telemetryValue}>
        <QueryClientProvider client={qc}>
          <SiteContextProvider
            client={client}
            storage={value.storage}
            {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
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

/**
 * Manages the active-site state. Sits inside `QueryClientProvider` so
 * `setSite` can invalidate the React-Query cache on switch.
 */
function SiteContextProvider({
  client,
  storage,
  initialSiteCode,
  children,
}: {
  client: EmporixClient;
  storage: EmporixStorage;
  initialSiteCode?: string;
  children: ReactNode;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [siteCode, setSiteCodeState] = useState<string | null>(() => {
    if (initialSiteCode !== undefined) return initialSiteCode;
    const fromStorage = storage.getSiteCode();
    if (fromStorage !== null) return fromStorage;
    return client.config?.credentials?.storefront?.context?.siteCode ?? null;
  });
  const [currency, setCurrencyState] = useState<string | null>(
    () => client.config?.credentials?.storefront?.context?.currency ?? null,
  );
  const [targetLocation, setTargetLocation] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<Error | null>(null);

  // Mount-time derivation: if a siteCode is already resolved, fetch its DTO
  // once so currency + targetLocation populate without a user-driven switch.
  useEffect(() => {
    if (!siteCode || currency !== null) return;
    let cancelled = false;
    const token = storage.getCustomerToken();
    const authCtx = token ? auth.customer(token) : auth.anonymous();
    qc.fetchQuery({
      queryKey: [
        "emporix",
        "site-by-code",
        siteCode,
        { tenant: client.tenant, authKind: authCtx.kind },
      ],
      queryFn: () => client.sites.get(siteCode, authCtx),
      staleTime: 5 * 60_000,
    })
      .then((site) => {
        if (cancelled) return;
        setCurrencyState(site.currency);
        setTargetLocation(site.homeBase?.address?.country ?? null);
      })
      .catch(() => {
        // Best-effort — silent. setSite-driven derivation surfaces real errors.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteCode]);

  const setSite = useCallback(
    async (code: string | null) => {
      // 1) Optimistic flip — UI moves immediately.
      storage.setSiteCode(code);
      storage.setCartId(null);
      setSiteCodeState(code);
      setSwitchError(null);
      void qc.invalidateQueries({ queryKey: ["emporix"] });

      if (code === null) {
        setCurrencyState(null);
        setTargetLocation(null);
        return;
      }

      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        // 2) Derive currency + targetLocation from the site DTO (cached 5min).
        const site = await qc.fetchQuery({
          queryKey: [
            "emporix",
            "site-by-code",
            code,
            { tenant: client.tenant, authKind: authCtx.kind },
          ],
          queryFn: () => client.sites.get(code, authCtx),
          staleTime: 5 * 60_000,
        });
        const nextCurrency = site.currency;
        const nextTarget = site.homeBase?.address?.country ?? null;
        setCurrencyState(nextCurrency);
        setTargetLocation(nextTarget);
        // 3) Push everything into the session-context PATCH.
        await client.sessionContext.patch(
          {
            siteCode: code,
            ...(nextCurrency ? { currency: nextCurrency } : {}),
            ...(nextTarget ? { targetLocation: nextTarget } : {}),
          },
          authCtx,
        );
      } catch (e) {
        setSwitchError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsSwitching(false);
      }
    },
    [client, storage, qc],
  );

  const setCurrency = useCallback(
    async (next: string) => {
      // Carts are currency-bound — drop the guest cart so a fresh one is created.
      storage.setCartId(null);
      setCurrencyState(next);
      setSwitchError(null);
      // Re-bind the anonymous price context so guest pricing uses the new
      // currency even before a session/cart exists (sessionContext.patch can't).
      client.setStorefrontContext({ currency: next });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        // Update an existing server session context (no-op / returns false pre-cart).
        await client.sessionContext.patch(
          { currency: next, ...(siteCode ? { siteCode } : {}) },
          authCtx,
        );
      } catch (e) {
        setSwitchError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setIsSwitching(false);
      }
    },
    [client, storage, qc, siteCode],
  );

  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency,
      targetLocation,
      setSite,
      setCurrency,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, setSite, setCurrency, isSwitching, switchError],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
