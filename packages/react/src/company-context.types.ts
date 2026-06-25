import type { LegalEntity } from "@viu/emporix-sdk";

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

export const NULL_CTX: CompanyContextValue = {
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
