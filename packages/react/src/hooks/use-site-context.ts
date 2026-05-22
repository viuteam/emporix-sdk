import { useContext } from "react";
import { EmporixSiteContext, type SiteContextValue } from "../provider";

/**
 * Returns the active site context: `{ siteCode, currency, targetLocation,
 * setSite }`. In MS-2, `currency` and `targetLocation` are always `null`;
 * they auto-populate in MS-4. `setSite(code)` is sync void in MS-2; it
 * becomes async in MS-3 (PATCHing `/session-context/{tenant}/me/context`).
 */
export function useSiteContext(): SiteContextValue {
  const ctx = useContext(EmporixSiteContext);
  if (!ctx) {
    throw new Error("useSiteContext must be used within an EmporixProvider");
  }
  return ctx;
}
