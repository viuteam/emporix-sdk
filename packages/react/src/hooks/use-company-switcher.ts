import { useCallback } from "react";
import type { LegalEntity } from "@viu/emporix-sdk";
import { useActiveCompany } from "../company-context";

export interface CompanySwitcherApi {
  companies: LegalEntity[];
  active: LegalEntity | null;
  status: "idle" | "loading" | "switching" | "error";
  switch: (legalEntityId: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** UI-friendly wrapper around useActiveCompany — exposes switch/clear pair. */
export function useCompanySwitcher(): CompanySwitcherApi {
  const ctx = useActiveCompany();
  const switchFn = useCallback(
    (legalEntityId: string) => ctx.setActiveCompany(legalEntityId),
    [ctx],
  );
  const clearFn = useCallback(() => ctx.setActiveCompany(null), [ctx]);
  return {
    companies: ctx.myCompanies,
    active: ctx.activeCompany,
    status: ctx.status,
    switch: switchFn,
    clear: clearFn,
  };
}
