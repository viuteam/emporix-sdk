import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";
import { EmporixTelemetryContext, type EmporixTelemetryEvent } from "./telemetry";
import { CompanyContextProvider } from "./company-context";
import type {
  EmporixContextValue,
  EmporixProviderProps,
  SiteContextValue,
} from "./provider.types";

export type { EmporixProviderProps, SiteContextValue } from "./provider.types";

const EmporixContext = createContext<EmporixContextValue | null>(null);
export const EmporixSiteContext = createContext<SiteContextValue | null>(null);

/**
 * Balanced React-Query defaults scoped to the `["emporix"]` key namespace of
 * whatever QueryClient is active (the fallback OR a consumer-supplied one).
 * Keeps the Emporix API-quota in check by suppressing window-focus refetches
 * and capping retries. Consumer-set emporix defaults and per-hook options win.
 */
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

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
  // Defaults are applied below via setQueryDefaults, scoped to ["emporix"].
  const [fallbackQc] = useState(() => new QueryClient());
  const qc = queryClient ?? fallbackQc;

  // Scope our balanced defaults to the ["emporix"] key namespace on WHATEVER
  // QueryClient is in use — a bare consumer client (e.g. the next-app-router
  // example) otherwise runs SDK queries with React-Query factory defaults
  // (staleTime 0, focus refetch, retry 3 → multiplied by the SDK's own HTTP
  // retry). We only FILL GAPS: a consumer's explicit choices win, whether set
  // globally (`defaultOptions.queries`) or emporix-scoped — both are spread
  // after ours. Host-app queries outside the namespace are untouched.
  // Ref-guarded: re-applies only for a new client.
  const defaultsRef = useRef<QueryClient | null>(null);
  if (defaultsRef.current !== qc) {
    qc.setQueryDefaults(["emporix"], {
      ...DEFAULT_QUERY_OPTIONS,
      ...qc.getDefaultOptions().queries,
      ...qc.getQueryDefaults(["emporix"]),
    });
    defaultsRef.current = qc;
  }

  // Idempotent wiring that must precede the children's first fetch effects:
  // (1) attach the storage-backed anonymous-session adapter to the SDK token
  // provider, (2) seed the SSR-provided customer token into external storage.
  // Ref-guarded so it re-runs when (client, storage) identity changes — a
  // useState lazy initializer runs once per component INSTANCE and silently
  // skips re-wiring on prop swaps; a useEffect runs AFTER children fetch.
  const wiredRef = useRef<{ client: EmporixClient; storage: EmporixStorage } | null>(null);
  if (wiredRef.current?.client !== client || wiredRef.current?.storage !== value.storage) {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => value.storage.getAnonymousSession(),
      write: (s) => value.storage.setAnonymousSession(s),
    });
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    wiredRef.current = { client, storage: value.storage };
  }

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

/**
 * Manages the active-site state. Sits inside `QueryClientProvider` so
 * `setSite` can invalidate the React-Query cache on switch.
 */
function SiteContextProvider({
  client,
  storage,
  initialSiteCode,
  initialLanguage,
  children,
}: {
  client: EmporixClient;
  storage: EmporixStorage;
  initialSiteCode?: string;
  initialLanguage?: string;
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
  const [language, setLanguageState] = useState<string | null>(() => {
    if (initialLanguage !== undefined) return initialLanguage;
    const fromStorage = storage.getLanguage();
    if (fromStorage !== null) return fromStorage;
    return client.config?.credentials?.storefront?.context?.language ?? null;
  });
  const [targetLocation, setTargetLocation] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<Error | null>(null);

  // Mount-time derivation: if a siteCode is already resolved, fetch its DTO
  // once so currency + targetLocation populate without a user-driven switch.
  // A currency seeded from the client config is NOT overridden (the user's /
  // persisted choice wins); only fields still `null` are filled in.
  useEffect(() => {
    if (!siteCode || (currency !== null && targetLocation !== null && language !== null)) return;
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
        if (currency === null) setCurrencyState(site.currency);
        setTargetLocation(site.homeBase?.address?.country ?? null);
        if (language === null && site.defaultLanguage) {
          setLanguageState(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
      })
      .catch(() => {
        // Best-effort — silent. setSite-driven derivation surfaces real errors.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteCode]);

  // Push the initially-resolved language (prop / storage / config) to the SDK so
  // the very first reads carry `Accept-Language` — React state alone does not
  // reach the client. Mount-only; later changes go through setLanguage / setSite.
  useEffect(() => {
    if (language) client.setStorefrontContext({ language });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Reset the language if the new site doesn't support the active one.
        if (site.languages && !site.languages.includes(language ?? "") && site.defaultLanguage) {
          setLanguageState(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
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
    [client, storage, qc, language],
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

  const setLanguage = useCallback(
    async (next: string) => {
      storage.setLanguage(next);
      setLanguageState(next);
      setSwitchError(null);
      // Header source — applies to anonymous + pre-session reads too.
      client.setStorefrontContext({ language: next });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      setIsSwitching(true);
      try {
        const token = storage.getCustomerToken();
        const authCtx = token ? auth.customer(token) : auth.anonymous();
        // Update an existing server session context (no-op / returns false pre-cart).
        await client.sessionContext.patch(
          { language: next, ...(siteCode ? { siteCode } : {}) },
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
      language,
      setSite,
      setCurrency,
      setLanguage,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, language, setSite, setCurrency, setLanguage, isSwitching, switchError],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
