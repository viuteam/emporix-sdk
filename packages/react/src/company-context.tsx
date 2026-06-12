import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth, type EmporixClient, type LegalEntity } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage";
import { useEmporixTelemetry } from "./telemetry";

export type CompanyMode = "b2c" | "b2b" | "unresolved";

export interface CompanyContextValue {
  /** Active legal entity. `null` = B2C mode. */
  activeCompany: LegalEntity | null;
  /** All legal entities the customer is assigned to. */
  myCompanies: LegalEntity[];
  /**
   * `b2b` = a company is active; `b2c` = none active (and ≤1 available);
   * `unresolved` = multiple companies available, none picked yet — the
   * storefront must render a picker.
   */
  mode: CompanyMode;
  status: "idle" | "loading" | "switching" | "error";
  error: unknown;
  /**
   * Switch the active company. Eagerly calls
   * `client.customers.refresh({ legalEntityId })` so the customer token is
   * rescoped server-side, drops the cart id, then invalidates company-scoped
   * queries. Falls back to a local-state-only update when no refresh token
   * is in storage (e.g. fresh page load with memory storage).
   */
  setActiveCompany: (legalEntityId: string | null) => Promise<void>;
  refetchMyCompanies: () => Promise<void>;
}

const NULL_CTX: CompanyContextValue = {
  activeCompany: null,
  myCompanies: [],
  mode: "b2c",
  status: "idle",
  error: null,
  setActiveCompany: async () => {
    throw new Error("CompanyContextProvider not mounted");
  },
  refetchMyCompanies: async () => {},
};

export const EmporixCompanyContext = createContext<CompanyContextValue>(NULL_CTX);

/** Returns the active-company context. Safe outside the provider — returns idle B2C defaults. */
export function useActiveCompany(): CompanyContextValue {
  return useContext(EmporixCompanyContext);
}

export interface CompanyContextProviderProps {
  client: EmporixClient;
  storage: EmporixStorage;
  initialActiveLegalEntityId?: string | null;
  children: ReactNode;
}

export function CompanyContextProvider({
  client,
  storage,
  initialActiveLegalEntityId,
  children,
}: CompanyContextProviderProps): React.JSX.Element {
  const qc = useQueryClient();
  const { emit } = useEmporixTelemetry();
  const [myCompanies, setMyCompanies] = useState<LegalEntity[]>([]);
  const [activeCompany, setActive] = useState<LegalEntity | null>(null);
  const [status, setStatus] = useState<CompanyContextValue["status"]>("idle");
  const [error, setError] = useState<unknown>(null);
  // Ref so switchTo can capture the latest `activeCompany` for telemetry `from`.
  // Written in an effect: render-phase ref writes are illegal under concurrent
  // rendering (an abandoned render's value could leak into a committed pass).
  const activeRef = useRef<LegalEntity | null>(null);
  useEffect(() => {
    activeRef.current = activeCompany;
  }, [activeCompany]);

  // Serializes token-rotating switches: two concurrent switchTo calls would
  // both read the same refresh token; with server-side rotation the second
  // consumes a stale token (401, worst case session revocation).
  const switchChain = useRef<Promise<void>>(Promise.resolve());

  /** Internal: eager refresh + storage write + state update. */
  const switchTo = useCallback(
    (target: LegalEntity | null): Promise<void> => {
      const run = async (): Promise<void> => {
        const start = Date.now();
        const from = activeRef.current?.id ?? null;
        const refreshToken = storage.getRefreshToken();
        const token = storage.getCustomerToken();
        if (!refreshToken || !token) {
          // Local-state-only fallback — no rescope possible.
          setActive(target);
          storage.setActiveLegalEntityId(target?.id ?? null);
        } else {
          const next = await client.customers.refresh({
            refreshToken,
            ...(target ? { legalEntityId: target.id } : {}),
          });
          storage.setCustomerToken(next.customerToken);
          if (next.refreshToken) storage.setRefreshToken(next.refreshToken);
          storage.setCartId(null);
          storage.setActiveLegalEntityId(target?.id ?? null);
          setActive(target);
          qc.invalidateQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey.some(
                (k) =>
                  k === "cart" ||
                  k === "companies" ||
                  k === "customer" ||
                  k === from ||
                  (target !== null && k === target.id),
              ),
          });
        }
        emit({
          type: "company:switched",
          from,
          to: target?.id ?? null,
          durationMs: Date.now() - start,
        });
      };
      // Chain on the previous switch so concurrent calls run in order and each
      // reads the refresh token the prior switch rotated to.
      const task = switchChain.current.then(run, run);
      switchChain.current = task.catch(() => {
        /* keep the chain alive after a failed switch */
      });
      return task;
    },
    [client, storage, qc, emit],
  );

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const token = storage.getCustomerToken();
      if (!token) {
        if (signal?.cancelled) return;
        setMyCompanies([]);
        setActive(null);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      try {
        const companies = await client.companies.listMine(auth.customer(token));
        if (signal?.cancelled) return; // unmounted (StrictMode probe) — no state, no auto-switch
        setMyCompanies(companies);
        const persisted = initialActiveLegalEntityId ?? storage.getActiveLegalEntityId();
        const matched = persisted ? companies.find((c) => c.id === persisted) ?? null : null;
        if (matched) {
          setActive(matched);
          if (storage.getActiveLegalEntityId() !== matched.id) {
            storage.setActiveLegalEntityId(matched.id ?? null);
          }
        } else if (companies.length === 1) {
          await switchTo(companies[0] ?? null);
        } else {
          setActive(null);
          if (persisted && !matched) storage.setActiveLegalEntityId(null);
        }
        if (signal?.cancelled) return;
        setStatus("idle");
      } catch (e) {
        if (signal?.cancelled) return;
        setError(e);
        setStatus("error");
      }
    },
    [client, storage, initialActiveLegalEntityId, switchTo],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  // Re-run bootstrap only on token-presence transitions (login/logout). A
  // mid-session token swap (e.g. switch-driven refresh) keeps prev/next both
  // truthy and is ignored — otherwise the auto-pick branch would clobber an
  // explicit B2C choice as soon as the new token is written.
  useEffect(() => {
    let prev = storage.getCustomerToken();
    return storage.subscribe?.((next) => {
      const becameAuth = !prev && next;
      const becameUnauth = prev && !next;
      prev = next;
      if (becameAuth || becameUnauth) void load();
    });
  }, [storage, load]);

  const setActiveCompany = useCallback(
    async (legalEntityId: string | null) => {
      setStatus("switching");
      try {
        if (legalEntityId === null) {
          await switchTo(null);
        } else {
          const target = myCompanies.find((c) => c.id === legalEntityId) ?? null;
          if (!target) throw new Error(`setActiveCompany: unknown legalEntityId ${legalEntityId}`);
          await switchTo(target);
        }
        setStatus("idle");
      } catch (e) {
        setError(e);
        setStatus("error");
        throw e;
      }
    },
    [myCompanies, switchTo],
  );

  const value = useMemo<CompanyContextValue>(() => {
    const mode: CompanyMode = activeCompany
      ? "b2b"
      : myCompanies.length > 1
        ? "unresolved"
        : "b2c";
    return {
      activeCompany,
      myCompanies,
      mode,
      status,
      error,
      setActiveCompany,
      refetchMyCompanies: load,
    };
  }, [activeCompany, myCompanies, status, error, setActiveCompany, load]);

  return (
    <EmporixCompanyContext.Provider value={value}>{children}</EmporixCompanyContext.Provider>
  );
}
