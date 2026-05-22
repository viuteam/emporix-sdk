import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";

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
  isSwitching: boolean;
  switchError: Error | null;
}

const EmporixContext = createContext<EmporixContextValue | null>(null);
export const EmporixSiteContext = createContext<SiteContextValue | null>(null);

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
  children: ReactNode;
}

/** Provides the SDK client, token storage, react-query client, and site context to the tree. */
export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  initialSiteCode,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, storage, initialCustomerToken]);
  const qc = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);

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

  return (
    <EmporixContext.Provider value={value}>
      <QueryClientProvider client={qc}>
        <SiteContextProvider
          client={client}
          storage={value.storage}
          {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
        >
          {children}
        </SiteContextProvider>
      </QueryClientProvider>
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
  const [currency, setCurrency] = useState<string | null>(null);
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
        setCurrency(site.currency);
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
        setCurrency(null);
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
        setCurrency(nextCurrency);
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

  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency,
      targetLocation,
      setSite,
      isSwitching,
      switchError,
    }),
    [siteCode, currency, targetLocation, setSite, isSwitching, switchError],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}

/** Returns the SDK client and token storage. Throws outside an {@link EmporixProvider}. */
export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
