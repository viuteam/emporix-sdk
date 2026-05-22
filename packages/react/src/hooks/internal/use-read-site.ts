import { useContext } from "react";
import { EmporixSiteContext } from "../../provider";

/**
 * Internal: returns the active `siteCode` from the EmporixProvider's site
 * context. Used by site-aware Read-Hooks to compose their query keys.
 *
 * Returns `null` when no site context is mounted — hooks use `null` in the
 * query key so cache entries are deterministic.
 */
export function useReadSite(): { siteCode: string | null } {
  const ctx = useContext(EmporixSiteContext);
  return { siteCode: ctx?.siteCode ?? null };
}
