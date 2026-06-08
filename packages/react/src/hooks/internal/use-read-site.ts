import { useContext } from "react";
import { EmporixSiteContext } from "../../provider";

/**
 * Internal: returns the active `siteCode` and `language` from the
 * EmporixProvider's site context. Used by site-aware read hooks to compose
 * their query keys. Both are `null` when no site context is mounted — hooks
 * use `null` in the query key so cache entries are deterministic.
 */
export function useReadSite(): { siteCode: string | null; language: string | null } {
  const ctx = useContext(EmporixSiteContext);
  return { siteCode: ctx?.siteCode ?? null, language: ctx?.language ?? null };
}
