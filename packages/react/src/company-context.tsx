import { createContext, useContext, type ReactNode } from "react";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage";
import { useEmporixTelemetry } from "./telemetry";
import { NULL_CTX, type CompanyContextValue } from "./company-context.types";
import { useCompanyBootstrap } from "./hooks/internal/use-company-bootstrap";

export type { CompanyContextValue, CompanyMode } from "./company-context.types";

export const EmporixCompanyContext = createContext<CompanyContextValue>(NULL_CTX);

/** Returns the active-company context. Safe outside the provider — returns idle B2C defaults. */
export function useActiveCompany(): CompanyContextValue {
  return useContext(EmporixCompanyContext);
}

export interface CompanyContextProviderProps {
  client: EmporixClient;
  storage: EmporixStorage;
  initialActiveLegalEntityId?: string | null;
  /** See `EmporixProviderProps.customerSession`. Always resolved by the provider. */
  customerSession: "owned" | "external";
  children: ReactNode;
}

export function CompanyContextProvider({
  client,
  storage,
  initialActiveLegalEntityId,
  customerSession,
  children,
}: CompanyContextProviderProps): React.JSX.Element {
  const { emit } = useEmporixTelemetry();
  const value = useCompanyBootstrap({
    client,
    storage,
    emit,
    customerSession,
    ...(initialActiveLegalEntityId !== undefined ? { initialActiveLegalEntityId } : {}),
  });

  return (
    <EmporixCompanyContext.Provider value={value}>{children}</EmporixCompanyContext.Provider>
  );
}
