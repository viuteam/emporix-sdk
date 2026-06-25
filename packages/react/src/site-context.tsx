import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import type { SiteContextValue } from "./provider.types";

export const EmporixSiteContext = createContext<SiteContextValue | null>(null);

/**
 * Runs the `isSwitching`-bracketed async tail shared by setSite / setCurrency /
 * setLanguage: flip the in-flight flag, await the server work, surface a failure
 * via `switchError` WITHOUT rolling back the already-applied optimistic state.
 * Each caller keeps its own optimistic flip + cache invalidation (those differ).
 */
async function runSwitch(
  work: () => Promise<unknown>,
  setIsSwitching: (b: boolean) => void,
  setSwitchError: (e: Error | null) => void,
): Promise<void> {
  setIsSwitching(true);
  try {
    await work();
  } catch (e) {
    setSwitchError(e instanceof Error ? e : new Error(String(e)));
  } finally {
    setIsSwitching(false);
  }
}

/**
 * Manages the active-site state. Sits inside `QueryClientProvider` so
 * `setSite` can invalidate the React-Query cache on switch.
 */
export function SiteContextProvider({
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

      await runSwitch(
        async () => {
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
        },
        setIsSwitching,
        setSwitchError,
      );
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
      await runSwitch(
        async () => {
          const token = storage.getCustomerToken();
          const authCtx = token ? auth.customer(token) : auth.anonymous();
          // Update an existing server session context (no-op / returns false pre-cart).
          await client.sessionContext.patch(
            { currency: next, ...(siteCode ? { siteCode } : {}) },
            authCtx,
          );
        },
        setIsSwitching,
        setSwitchError,
      );
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
      await runSwitch(
        async () => {
          const token = storage.getCustomerToken();
          const authCtx = token ? auth.customer(token) : auth.anonymous();
          // Update an existing server session context (no-op / returns false pre-cart).
          await client.sessionContext.patch(
            { language: next, ...(siteCode ? { siteCode } : {}) },
            authCtx,
          );
        },
        setIsSwitching,
        setSwitchError,
      );
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
